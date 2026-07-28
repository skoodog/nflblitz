#!/usr/bin/env node
// FOUNDATION — FROZEN after t=0. Do not edit.
//
// Live progress page generator.
//
//   node tools/progress.mjs                      -> progress/index.html
//   node tools/progress.mjs --inline             -> inline EVERY thumbnail as a data: URI
//   node tools/progress.mjs --out=progress/x.html
//
// Reads progress/events.jsonl (one JSON object per line, append-only, written only by
// scripts/log-event.mjs) plus whatever PNGs exist under shots/, and emits ONE
// self-contained HTML file: inline CSS, inline JS, no CDN, no build step, no fetch
// required to render.
//
// When the page is SERVED over http (node scripts/serve.mjs --progress) it also tails
// events.jsonl with byte-Range requests every 3 s and animates in what changed. Opened
// from file:// it falls back to the inlined bootstrap snapshot.
//
// Must never crash on an empty or partial log.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/* ------------------------------------------------------------------- args */
const A = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i < 0) A[a.slice(2)] = true; else A[a.slice(2, i)] = a.slice(i + 1);
}
const OUT = path.resolve(REPO, (A.out && A.out !== true) ? String(A.out) : 'progress/index.html');
const FORCE_INLINE = !!A.inline;
const INLINE_BUDGET = Number(A.budget || (FORCE_INLINE ? 400 : 44) * 1024 * 1024);

/* --------------------------------------------------- piece list (mirrors registry) */

const FALLBACK_PIECES = [
  'brand-identity', 'character-anatomy', 'cinematography', 'hud-overlay', 'impact-fx',
  'menu-playcall', 'menu-team-select', 'menu-title', 'play-sim', 'pose-animation',
  'score-callout', 'stadium-env', 'stadium-lighting', 'turf-field', 'typeface-lettering',
  'uniform-kit',
];
const FALLBACK_HEROES = {
  'brand-identity': ['team_select', 'title'],
  'character-anatomy': ['truck', 'leveler'],
  'cinematography': ['midair_hit', 'touchdown'],
  'hud-overlay': ['qb_dropback', 'truck'],
  'impact-fx': ['leveler', 'midair_hit'],
  'menu-playcall': ['playcall_def'],
  'menu-team-select': ['team_select'],
  'menu-title': ['title'],
  'play-sim': ['live_play', 'qb_dropback'],
  'pose-animation': ['truck', 'catch'],
  'score-callout': ['midair_hit', 'truck'],
  'stadium-env': ['qb_dropback', 'catch'],
  'stadium-lighting': ['midair_hit', 'qb_dropback'],
  'turf-field': ['truck', 'touchdown'],
  'typeface-lettering': ['title', 'midair_hit'],
  'uniform-kit': ['uniform', 'truck'],
};
const SCENE_PANELS = {
  title: 'title', qb_dropback: 'qb_dropback', midair_hit: 'midair_hit',
  team_select: 'team_select', truck: 'truck', playcall_def: 'defense_playcall',
  leveler: 'leveler', touchdown: 'touchdown', uniform: 'uniform', catch: 'catch',
  live_play: 'qb_dropback',
};
const PIECE_TITLES = {
  'brand-identity': 'Brand Identity',
  'character-anatomy': 'Character Anatomy',
  'cinematography': 'Cinematography',
  'hud-overlay': 'HUD Overlay',
  'impact-fx': 'Impact FX',
  'menu-playcall': 'Playcall Menu',
  'menu-team-select': 'Team Select Menu',
  'menu-title': 'Title Screen',
  'play-sim': 'Play Simulation',
  'pose-animation': 'Pose & Animation',
  'score-callout': 'Score Callouts',
  'stadium-env': 'Stadium Environment',
  'stadium-lighting': 'Stadium Lighting',
  'turf-field': 'Turf & Field',
  'typeface-lettering': 'Typeface & Lettering',
  'uniform-kit': 'Uniform Kit',
};

let PIECES = FALLBACK_PIECES, HEROES = FALLBACK_HEROES;
try {
  const reg = await import(path.join(REPO, 'src/foundation/registry.js'));
  if (Array.isArray(reg.PIECE_IDS) && reg.PIECE_IDS.length) PIECES = reg.PIECE_IDS;
  if (reg.PIECE_HEROES) HEROES = reg.PIECE_HEROES;
} catch { /* three.js unavailable in node — the mirrored lists above are fine */ }

/* ------------------------------------------------------------------ events */

function readEvents() {
  const p = path.join(REPO, 'progress', 'events.jsonl');
  if (!fs.existsSync(p)) return { events: [], bytes: 0 };
  const raw = fs.readFileSync(p, 'utf8');
  const events = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') events.push(o);
    } catch { /* tolerate a torn line; the next run picks it up */ }
  }
  return { events, bytes: Buffer.byteLength(raw, 'utf8') };
}

/* ------------------------------------------------------------------ images */

function listShots() {
  const root = path.join(REPO, 'shots');
  const out = [];
  const walk = (d) => {
    let e;
    try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const it of e) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else if (/\.(png|jpe?g|webp)$/i.test(it.name)) out.push(path.relative(REPO, p).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

function listBar() {
  const dir = path.join(REPO, 'bar');
  try {
    return fs.readdirSync(dir).filter((f) => /^panel-.*\.png$/.test(f)).map((f) => `bar/${f}`);
  } catch { return []; }
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function dataUri(rel) {
  const abs = path.join(REPO, rel);
  const buf = fs.readFileSync(abs);
  const mime = MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/* -------------------------------------------------------------- assemble */

const { events, bytes } = readEvents();
const shots = listShots();
const bar = listBar();

// Inline only what the page can actually reference: every bar panel, plus every
// shot/cmp path named by an event. Blindly inlining all of shots/ would bloat the
// file with captures nothing links to. Anything skipped falls back to a relative URL,
// which still resolves when the page is served (scripts/serve.mjs --progress).
function mtime(rel) {
  try { return fs.statSync(path.join(REPO, rel)).mtimeMs; } catch { return 0; }
}
const referenced = new Set();
for (const e of events) {
  if (e.shot) referenced.add(String(e.shot).replace(/^\.?\//, ''));
  if (e.cmp) referenced.add(String(e.cmp).replace(/^\.?\//, ''));
}
if (!referenced.size) {
  // nothing logged yet — seed the board with whatever the foundation smoke test made
  for (const s of shots) if (/^shots\/(foundation\.png|all\/)/.test(s)) referenced.add(s);
}
const shotPriority = shots
  .filter((s) => referenced.has(s))
  .sort((a, b) => mtime(b) - mtime(a));
const priority = [...bar, ...shotPriority];

const IMAGES = {};
let used = 0;
for (const rel of priority) {
  let size = 0;
  try { size = fs.statSync(path.join(REPO, rel)).size; } catch { continue; }
  if (used + size * 1.37 > INLINE_BUDGET) { IMAGES[rel] = null; continue; }
  try { IMAGES[rel] = dataUri(rel); used += size * 1.37; } catch { IMAGES[rel] = null; }
}

const BOOT = {
  generatedAt: new Date().toISOString(),
  bytes,
  pieces: PIECES.map((id) => ({ id, title: PIECE_TITLES[id] || id, heroes: HEROES[id] || [] })),
  scenePanels: SCENE_PANELS,
  events,
  shots,
  images: IMAGES,
  inlineNote: used > 0 ? `${(used / 1048576).toFixed(1)} MB inlined` : 'no images inlined',
};

/* -------------------------------------------------------------------- page */

const CSS = `
:root{
  --bg:#080a0f; --bg2:#0e1118; --card:#12151d; --card2:#171b25;
  --ink:#e9eaf0; --dim:#98a0b0; --faint:#5d6473; --line:#232937;
  --gold:#f0c34a; --red:#e03a3a; --amber:#f0973a; --green:#4fd07a;
  --blue:#3f9de6; --shadow:0 10px 30px rgba(0,0,0,.55);
}
@media (prefers-color-scheme: light){
  :root:not([data-theme="dark"]){
    --bg:#eceef3; --bg2:#e2e5ec; --card:#fff; --card2:#f4f6fa;
    --ink:#131722; --dim:#4d5566; --faint:#828b9c; --line:#d3d8e2;
    --shadow:0 8px 24px rgba(20,26,40,.14);
  }
}
:root[data-theme="light"]{
  --bg:#eceef3; --bg2:#e2e5ec; --card:#fff; --card2:#f4f6fa;
  --ink:#131722; --dim:#4d5566; --faint:#828b9c; --line:#d3d8e2;
  --shadow:0 8px 24px rgba(20,26,40,.14);
}
:root[data-theme="dark"]{
  --bg:#080a0f; --bg2:#0e1118; --card:#12151d; --card2:#171b25;
  --ink:#e9eaf0; --dim:#98a0b0; --faint:#5d6473; --line:#232937;
  --shadow:0 10px 30px rgba(0,0,0,.55);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);
  font-family:"Liberation Sans","DejaVu Sans",Arial,Helvetica,sans-serif;
  -webkit-font-smoothing:antialiased;}
a{color:var(--blue)}
.wrap{max-width:1680px;margin:0 auto;padding:0 20px 80px}

/* ---- header ---- */
header{position:relative;overflow:hidden;background:
  radial-gradient(120% 160% at 50% -30%, #2a1420 0%, transparent 60%),
  linear-gradient(180deg,var(--bg2),var(--bg));
  border-bottom:1px solid var(--line);margin-bottom:26px}
header .inner{max-width:1680px;margin:0 auto;padding:26px 20px 22px;
  display:flex;flex-wrap:wrap;gap:20px;align-items:center}
.chev{width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;
  border-top:26px solid var(--red);filter:drop-shadow(0 0 10px rgba(224,58,58,.55));flex:0 0 auto}
h1{margin:0;font-size:30px;letter-spacing:.06em;font-weight:900;font-style:italic;
  text-transform:uppercase;line-height:1}
h1 small{display:block;font-size:12px;letter-spacing:.34em;font-weight:700;font-style:normal;
  color:var(--gold);margin-top:6px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;
  background:var(--card2);border:1px solid var(--line);font-weight:800;letter-spacing:.1em;font-size:13px}
.pill b{color:var(--gold);font-size:19px;font-style:italic}
.counters{display:flex;gap:10px;flex-wrap:wrap;margin-left:auto}
.counter{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;min-width:104px}
.counter .n{font-size:26px;font-weight:900;font-style:italic;line-height:1}
.counter .l{font-size:10px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase;margin-top:4px}
.counter.g .n{color:var(--green)} .counter.a .n{color:var(--amber)} .counter.b .n{color:var(--blue)}
#themeBtn{background:var(--card);border:1px solid var(--line);color:var(--dim);border-radius:8px;
  padding:8px 12px;cursor:pointer;font-size:12px;letter-spacing:.1em}

/* ---- sections ---- */
h2{font-size:13px;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);
  margin:34px 0 14px;font-weight:800;display:flex;align-items:center;gap:12px}
h2:after{content:"";flex:1;height:1px;background:var(--line)}

/* ---- chart ---- */
.chartbox{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;
  box-shadow:var(--shadow)}
.chartbox svg{display:block;width:100%;height:auto;max-height:340px;overflow:visible}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:11px;color:var(--dim)}
.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:5px;vertical-align:middle}

/* ---- board ---- */
.board{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(430px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;
  box-shadow:var(--shadow);cursor:pointer;transition:transform .12s ease,border-color .12s ease}
.card:hover{transform:translateY(-2px);border-color:var(--faint)}
.card .top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,var(--card2),transparent)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--faint);flex:0 0 auto}
.dot.building{background:var(--amber);animation:pulse 1.3s infinite}
.dot.shooting{background:var(--blue);animation:pulse 1.3s infinite}
.dot.judged{background:var(--green)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.28}}
.card .nm{font-weight:800;font-size:15px;letter-spacing:.02em}
.card .id{font:400 11px/1 "DejaVu Sans Mono",monospace;color:var(--faint);margin-top:3px}
.ring{margin-left:auto;position:relative;width:46px;height:46px;flex:0 0 auto}
.ring svg{transform:rotate(-90deg)}
.ring .v{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;font-weight:900;font-style:italic}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:2px;background:var(--line)}
.pair figure{margin:0;position:relative;background:#000;aspect-ratio:16/10;overflow:hidden}
.pair img{width:100%;height:100%;object-fit:contain;display:block}
.pair figcaption{position:absolute;left:0;top:0;padding:2px 7px;font-size:9px;letter-spacing:.16em;
  font-weight:800;background:rgba(0,0,0,.7);color:var(--gold)}
.pair figure.ours figcaption{color:var(--blue)}
.ph{width:100%;height:100%;display:grid;place-items:center;color:var(--faint);font-size:11px;
  background:repeating-linear-gradient(45deg,#14161d,#14161d 8px,#171a22 8px,#171a22 16px);text-align:center;padding:8px}
.gap{padding:11px 14px;font-size:13px;line-height:1.5;color:var(--ink);border-top:1px solid var(--line);
  background:var(--card2);min-height:44px}
.gap b{color:var(--red);font-size:10px;letter-spacing:.2em;display:block;margin-bottom:3px}
.gap.empty{color:var(--faint);font-style:italic}
.strip{display:flex;gap:6px;padding:10px 14px 13px;overflow-x:auto;border-top:1px solid var(--line)}
.strip::-webkit-scrollbar{height:6px}
.strip::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.thumb{position:relative;flex:0 0 auto;width:96px;height:60px;border-radius:5px;overflow:hidden;
  border:1px solid var(--line);background:#000}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb .b{position:absolute;left:0;bottom:0;right:0;font-size:9px;font-weight:800;padding:1px 4px;
  background:rgba(0,0,0,.78);display:flex;justify-content:space-between}
.thumb .b .r{color:var(--dim)}
.up{color:var(--green)} .down{color:var(--red)} .flat{color:var(--faint)}
.strip .none{color:var(--faint);font-size:11px;font-style:italic;padding:18px 4px}

/* ---- detail ---- */
#detail{position:fixed;inset:0;background:rgba(4,6,10,.94);z-index:60;display:none;overflow:auto;
  backdrop-filter:blur(3px)}
#detail.on{display:block}
#detail .dwrap{max-width:1400px;margin:0 auto;padding:24px 20px 60px}
#detail .dhead{display:flex;align-items:center;gap:14px;margin-bottom:16px}
#detail h3{margin:0;font-size:22px;font-weight:900;font-style:italic;letter-spacing:.04em}
#close{margin-left:auto;background:var(--card);border:1px solid var(--line);color:var(--ink);
  border-radius:8px;padding:8px 14px;cursor:pointer}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.tools button{background:var(--card);border:1px solid var(--line);color:var(--dim);border-radius:8px;
  padding:7px 13px;cursor:pointer;font-size:12px;letter-spacing:.08em}
.tools button.on{border-color:var(--gold);color:var(--gold)}
#wipeBox{position:relative;height:720px;background:#000;border:1px solid var(--line);border-radius:10px;
  overflow:hidden;user-select:none;display:grid;place-items:center}
#wipeBox .lay{position:absolute;inset:0;display:grid;place-items:center}
#wipeBox img{max-width:100%;max-height:100%;object-fit:contain;display:block}
#wipeClip{position:absolute;inset:0;overflow:hidden}
#wipeClip .lay{width:100%}
#seam{position:absolute;top:0;bottom:0;width:2px;background:var(--gold);cursor:ew-resize;
  box-shadow:0 0 10px rgba(240,195,74,.8)}
#seam:after{content:"";position:absolute;left:-11px;top:50%;width:24px;height:24px;margin-top:-12px;
  border-radius:50%;background:var(--gold);box-shadow:0 0 12px rgba(240,195,74,.7)}
.tl{margin-top:22px;border-left:2px solid var(--line);padding-left:16px}
.tl .row{position:relative;padding:8px 0;font-size:13px;color:var(--dim)}
.tl .row:before{content:"";position:absolute;left:-21px;top:14px;width:8px;height:8px;border-radius:50%;
  background:var(--faint)}
.tl .row.verdict:before{background:var(--gold)}
.tl .row b{color:var(--ink)}
.tl .row .g{color:var(--ink);font-style:italic}

/* ---- feed ---- */
.feed{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.feed .row{display:grid;grid-template-columns:150px 92px 140px 1fr;gap:12px;padding:9px 14px;
  border-bottom:1px solid var(--line);font-size:12.5px;align-items:baseline}
.feed .row:last-child{border-bottom:0}
.feed .row.new{animation:slide .5s ease}
@keyframes slide{from{opacity:0;transform:translateY(-8px);background:rgba(240,195,74,.14)}to{opacity:1}}
.feed .t{color:var(--faint);font:400 11px/1.5 "DejaVu Sans Mono",monospace}
.feed .a{font-weight:800;font-size:10px;letter-spacing:.14em;text-transform:uppercase}
.feed .a.builder{color:var(--blue)} .feed .a.critic{color:var(--gold)} .feed .a.lead{color:var(--red)}
.feed .p{color:var(--dim);font:400 11px/1.5 "DejaVu Sans Mono",monospace}
.feed .m b{color:var(--ink)}
.empty{padding:26px;text-align:center;color:var(--faint);font-style:italic}
.foot{margin-top:34px;color:var(--faint);font-size:11px;text-align:center;line-height:1.7}
`;

const CLIENT = String.raw`
(function(){
'use strict';
var BOOT = window.__BOOT__;
var PIECES = BOOT.pieces;
var PANELS = BOOT.scenePanels;
var IMAGES = BOOT.images || {};
var events = (BOOT.events||[]).slice();
var byteOffset = BOOT.bytes || 0;
var START = events.length ? Date.parse(events[0].ts) : Date.parse(BOOT.generatedAt);
var COLORS = ['#e05252','#e0873a','#e0c23a','#9fd04a','#4fd07a','#3fd0b0','#3fb0e6','#5f7fe6',
              '#8f6fe6','#c06fe6','#e06fb0','#e06f7a','#b09a6a','#7aa0b0','#9aa0c0','#c0a0a0'];

/* ---------- model ---------- */
function build(){
  var m = {};
  PIECES.forEach(function(p,i){
    m[p.id] = {id:p.id,title:p.title,heroes:p.heroes,color:COLORS[i%COLORS.length],
      rounds:{}, score:null, prevScore:null, gap:'', status:'idle', events:[], lastShot:null, lastCmp:null};
  });
  events.forEach(function(e){
    var p = m[e.piece]; if(!p) return;
    p.events.push(e);
    var r = e.round||0;
    if(!p.rounds[r]) p.rounds[r] = {round:r, score:null, gap:'', shots:[], cmp:null};
    var R = p.rounds[r];
    if(e.shot){ if(R.shots.indexOf(e.shot)<0) R.shots.push(e.shot); p.lastShot=e.shot; }
    if(e.cmp){ R.cmp = e.cmp; p.lastCmp = e.cmp; }
    if(typeof e.score === 'number'){ R.score = e.score; }
    if(e.gap){ R.gap = e.gap; }
    if(e.event==='start'||e.event==='build_done') p.status = e.event==='start'?'building':'shooting';
    if(e.event==='shot') p.status='shooting';
    if(e.event==='verdict') p.status='judged';
  });
  Object.keys(m).forEach(function(k){
    var p = m[k];
    var rs = Object.keys(p.rounds).map(Number).sort(function(a,b){return a-b;});
    p.roundList = rs.map(function(r){return p.rounds[r];});
    var scored = p.roundList.filter(function(r){return typeof r.score==='number';});
    p.score = scored.length ? scored[scored.length-1].score : null;
    p.prevScore = scored.length>1 ? scored[scored.length-2].score : null;
    for(var i=p.roundList.length-1;i>=0;i--){ if(p.roundList[i].gap){ p.gap=p.roundList[i].gap; break; } }
  });
  return m;
}

function src(rel, ts){
  if(!rel) return null;
  rel = String(rel).replace(/^\.?\//,'');
  if(IMAGES[rel]) return IMAGES[rel];
  if(location.protocol === 'file:') return null;
  return '../' + rel + (ts ? ('?v='+encodeURIComponent(ts)) : '');
}
function barFor(p){
  var scene = (p.heroes&&p.heroes[0]) || 'truck';
  var panel = PANELS[scene] || scene;
  return src('bar/panel-'+panel+'.png');
}
function scoreColor(s){
  if(s===null||s===undefined) return 'var(--faint)';
  if(s>=90) return 'var(--green)';
  if(s>=80) return '#8fd04a';
  if(s>=60) return 'var(--amber)';
  return 'var(--red)';
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

/* ---------- header ---------- */
function renderHeader(M){
  var rounds = events.map(function(e){return e.round||0;});
  var cur = rounds.length ? Math.max.apply(null, rounds) : 0;
  var vals = Object.keys(M).map(function(k){return M[k];});
  var building = vals.filter(function(p){return p.status==='building'||p.status==='shooting';}).length;
  var awaiting = vals.filter(function(p){return p.lastShot && p.score===null;}).length;
  var converged = vals.filter(function(p){return typeof p.score==='number' && p.score>=90;}).length;
  document.getElementById('roundPill').innerHTML = 'ROUND <b>'+cur+'</b>';
  var el = Date.now()-START;
  if(!isFinite(el)||el<0) el = 0;
  var h = Math.floor(el/3600000), mn = Math.floor(el/60000)%60;
  document.getElementById('elapsed').textContent = h+'h '+String(mn).padStart(2,'0')+'m';
  document.getElementById('cBuild').textContent = building;
  document.getElementById('cWait').textContent = awaiting;
  document.getElementById('cDone').textContent = converged;
}

/* ---------- convergence chart ---------- */
function renderChart(M){
  var vals = Object.keys(M).map(function(k){return M[k];});
  var maxR = 1;
  vals.forEach(function(p){ p.roundList.forEach(function(r){ if(r.round>maxR) maxR=r.round; }); });
  var W=1600,H=340,L=44,R=120,T=12,B=28;
  var iw=W-L-R, ih=H-T-B;
  function X(r){ return L + (maxR<=0?0:(r/maxR))*iw; }
  function Y(s){ return T + (1-(s/100))*ih; }
  var svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
  [0,25,50,75,100].forEach(function(g){
    svg+='<line x1="'+L+'" y1="'+Y(g)+'" x2="'+(W-R)+'" y2="'+Y(g)+'" stroke="var(--line)" stroke-width="1"/>';
    svg+='<text x="'+(L-8)+'" y="'+(Y(g)+4)+'" fill="var(--faint)" font-size="11" text-anchor="end">'+g+'</text>';
  });
  svg+='<line x1="'+L+'" y1="'+Y(90)+'" x2="'+(W-R)+'" y2="'+Y(90)+'" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="7 6"/>';
  svg+='<text x="'+(W-R)+'" y="'+(Y(90)-7)+'" fill="var(--gold)" font-size="11" text-anchor="end" letter-spacing="2">BAR REACHED</text>';
  for(var r=0;r<=maxR;r++){
    svg+='<text x="'+X(r)+'" y="'+(H-6)+'" fill="var(--faint)" font-size="11" text-anchor="middle">R'+r+'</text>';
  }
  var any=false;
  vals.forEach(function(p){
    var pts = p.roundList.filter(function(x){return typeof x.score==='number';});
    if(!pts.length) return;
    any=true;
    var col = scoreColor(p.score);
    var d = pts.map(function(x,i){ return (i?'L':'M')+X(x.round).toFixed(1)+' '+Y(x.score).toFixed(1); }).join(' ');
    svg+='<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="2.2" stroke-linejoin="round" opacity=".92"/>';
    pts.forEach(function(x){ svg+='<circle cx="'+X(x.round).toFixed(1)+'" cy="'+Y(x.score).toFixed(1)+'" r="3.2" fill="'+col+'"/>'; });
    var last = pts[pts.length-1];
    var lx = X(last.round)+8, anchor='start';
    if(lx > W-R+4){ lx = X(last.round)-8; anchor='end'; }
    svg+='<text x="'+lx.toFixed(1)+'" y="'+(Y(last.score)+3.5)+'" fill="'+col+'" font-size="11" text-anchor="'+anchor+'">'+esc(p.id)+'</text>';
  });
  if(!any) svg+='<text x="'+(W/2)+'" y="'+(H/2)+'" fill="var(--faint)" font-size="14" text-anchor="middle" font-style="italic">no verdicts logged yet</text>';
  svg+='</svg>';
  document.getElementById('chart').innerHTML = svg;
  document.getElementById('legend').innerHTML = vals.map(function(p){
    return '<span><i style="background:'+scoreColor(p.score)+'"></i>'+esc(p.id)+
      (typeof p.score==='number'?(' '+p.score):' —')+'</span>';
  }).join('');
}

/* ---------- board ---------- */
function ring(score){
  var s = (typeof score==='number')?score:0;
  var c = 2*Math.PI*19;
  return '<div class="ring"><svg width="46" height="46">'+
    '<circle cx="23" cy="23" r="19" fill="none" stroke="var(--line)" stroke-width="4"/>'+
    '<circle cx="23" cy="23" r="19" fill="none" stroke="'+scoreColor(score)+'" stroke-width="4"'+
    ' stroke-dasharray="'+(c*s/100).toFixed(1)+' '+c.toFixed(1)+'" stroke-linecap="round"/></svg>'+
    '<div class="v" style="color:'+scoreColor(score)+'">'+(typeof score==='number'?score:'–')+'</div></div>';
}
function figHTML(url, label, cls, alt){
  if(url) return '<figure class="'+cls+'"><img src="'+url+'" alt="'+esc(alt)+'" loading="lazy"><figcaption>'+label+'</figcaption></figure>';
  return '<figure class="'+cls+'"><div class="ph">'+esc(alt||'not captured yet')+'</div><figcaption>'+label+'</figcaption></figure>';
}
function renderBoard(M){
  var vals = Object.keys(M).map(function(k){return M[k];});
  vals.sort(function(a,b){
    var as = (typeof a.score==='number')?a.score:-1, bs=(typeof b.score==='number')?b.score:-1;
    if(as!==bs) return as-bs;
    return a.id<b.id?-1:1;
  });
  var html = vals.map(function(p){
    var barUrl = barFor(p);
    var ourUrl = src(p.lastShot, p.lastShot?String(p.events.length):'');
    var strip = p.roundList.map(function(r){
      var u = src(r.shots[r.shots.length-1]);
      var prev=null;
      for(var i=0;i<p.roundList.length;i++){ if(p.roundList[i].round<r.round && typeof p.roundList[i].score==='number') prev=p.roundList[i].score; }
      var d = (typeof r.score==='number' && prev!==null)?(r.score-prev):null;
      var dcls = d===null?'flat':(d>0?'up':(d<0?'down':'flat'));
      var dtxt = d===null?(typeof r.score==='number'?String(r.score):'–'):((d>0?'+':'')+d);
      return '<div class="thumb" data-swap="'+esc(r.shots[r.shots.length-1]||'')+'" data-piece="'+esc(p.id)+'">'+
        (u?'<img src="'+u+'" loading="lazy" alt="round '+r.round+'">':'<div class="ph">R'+r.round+'</div>')+
        '<div class="b"><span class="r">R'+r.round+'</span><span class="'+dcls+'">'+dtxt+'</span></div></div>';
    }).join('');
    return '<article class="card" data-piece="'+esc(p.id)+'">'+
      '<div class="top"><span class="dot '+p.status+'"></span><div><div class="nm">'+esc(p.title)+'</div>'+
      '<div class="id">'+esc(p.id)+'</div></div>'+ring(p.score)+'</div>'+
      '<div class="pair">'+figHTML(barUrl,'BAR','bar','bar panel missing')+
      figHTML(ourUrl,'OURS','ours','no capture yet — node scripts/shoot.mjs --piece='+p.id)+'</div>'+
      '<div class="gap'+(p.gap?'':' empty')+'">'+(p.gap?('<b>LATEST GAP</b>“'+esc(p.gap)+'”'):'no gap named yet')+'</div>'+
      '<div class="strip">'+(strip||'<span class="none">no rounds yet</span>')+'</div>'+
      '</article>';
  }).join('');
  document.getElementById('board').innerHTML = html;
}

/* ---------- feed ---------- */
var seen = {};
function renderFeed(){
  var rows = events.slice().reverse().slice(0,220).map(function(e){
    var key = e.ts+'|'+e.piece+'|'+e.event;
    var isNew = !seen[key]; seen[key]=1;
    var msg='';
    if(e.event==='verdict') msg='<b>'+(typeof e.score==='number'?e.score:'?')+'</b> — '+esc(e.gap||e.text||'');
    else if(e.event==='gap') msg='<i>'+esc(e.gap||e.text||'')+'</i>';
    else msg=esc(e.text||e.shot||e.cmp||'');
    return '<div class="row'+(isNew?' new':'')+'"><span class="t">'+esc((e.ts||'').replace('T',' ').replace(/\..*$/,''))+
      '</span><span class="a '+esc(e.agent||'builder')+'">'+esc(e.agent||'builder')+
      '</span><span class="p">'+esc(e.piece||'—')+'</span>'+
      '<span class="m"><b>'+esc(e.event)+'</b> '+msg+'</span></div>';
  }).join('');
  document.getElementById('feed').innerHTML = rows || '<div class="empty">no events logged yet — builders append with scripts/log-event.mjs</div>';
}

/* ---------- detail ---------- */
var MODEL = {};
var detailPiece = null;
function openDetail(id){
  var p = MODEL[id]; if(!p) return;
  detailPiece = p;
  document.getElementById('dTitle').textContent = p.title + '  ·  ' + (typeof p.score==='number'?p.score:'unscored');
  var barUrl = barFor(p), ourUrl = src(p.lastShot);
  document.getElementById('dBar').innerHTML = barUrl?'<img src="'+barUrl+'">':'<div class="ph">bar panel missing</div>';
  document.getElementById('dOurs').innerHTML = ourUrl?'<img src="'+ourUrl+'">':'<div class="ph">no capture yet</div>';
  setWipe(0.5);
  document.getElementById('dTl').innerHTML = p.events.map(function(e){
    var body='';
    if(e.event==='verdict') body='score <b>'+(typeof e.score==='number'?e.score:'?')+'</b>'+(e.gap?' · <span class="g">“'+esc(e.gap)+'”</span>':'');
    else body=esc(e.text||e.gap||e.shot||'');
    return '<div class="row '+esc(e.event)+'"><b>R'+(e.round||0)+' '+esc(e.event)+'</b> · '+
      esc((e.ts||'').replace('T',' ').replace(/\..*$/,''))+' · '+esc(e.agent||'')+'<br>'+body+'</div>';
  }).join('') || '<div class="row">no events for this piece yet</div>';
  document.getElementById('detail').classList.add('on');
}
function setWipe(k){
  k = Math.max(0,Math.min(1,k));
  var box = document.getElementById('wipeBox');
  var w = box.clientWidth||1;
  document.getElementById('wipeClip').style.width = Math.round(w*k)+'px';
  document.getElementById('seam').style.left = Math.round(w*k)+'px';
}
document.addEventListener('click', function(ev){
  var th = ev.target.closest && ev.target.closest('.thumb');
  if(th){
    ev.stopPropagation();
    var card = th.closest('.card');
    var u = src(th.getAttribute('data-swap'));
    var img = card && card.querySelector('.pair figure.ours img');
    if(u && img) img.src = u;
    else if(u && card){ var f = card.querySelector('.pair figure.ours'); if(f) f.innerHTML = '<img src="'+u+'"><figcaption>OURS</figcaption>'; }
    return;
  }
  var card2 = ev.target.closest && ev.target.closest('.card');
  if(card2){ openDetail(card2.getAttribute('data-piece')); }
});
document.getElementById('close').onclick = function(){ document.getElementById('detail').classList.remove('on'); };
document.getElementById('detail').addEventListener('click', function(e){ if(e.target.id==='detail') e.currentTarget.classList.remove('on'); });
(function(){
  var drag=false, box=document.getElementById('wipeBox');
  function upd(e){ var r=box.getBoundingClientRect(); setWipe((e.clientX-r.left)/r.width); }
  document.getElementById('seam').addEventListener('mousedown', function(e){ drag=true; e.preventDefault(); });
  window.addEventListener('mousemove', function(e){ if(drag) upd(e); });
  window.addEventListener('mouseup', function(){ drag=false; });
  box.addEventListener('click', function(e){ if(e.target.id!=='seam') upd(e); });
})();
document.getElementById('bDiff').onclick = function(){
  this.classList.toggle('on');
  document.getElementById('dOurs').style.mixBlendMode = this.classList.contains('on')?'difference':'normal';
};
document.getElementById('bOnion').onclick = function(){
  this.classList.toggle('on');
  var on = this.classList.contains('on');
  document.getElementById('wipeClip').style.width = on?'100%':'';
  document.getElementById('dOurs').style.opacity = on?'0.5':'1';
  if(!on) setWipe(0.5);
};
document.getElementById('themeBtn').onclick = function(){
  var r = document.documentElement;
  var cur = r.getAttribute('data-theme');
  var next = cur==='dark' ? 'light' : cur==='light' ? '' : 'dark';
  if(next) r.setAttribute('data-theme', next); else r.removeAttribute('data-theme');
  this.textContent = 'THEME: ' + (next||'auto').toUpperCase();
};

/* ---------- render + poll ---------- */
function renderAll(){
  MODEL = build();
  renderHeader(MODEL);
  renderChart(MODEL);
  renderBoard(MODEL);
  renderFeed();
}
renderAll();

if(location.protocol.indexOf('http')===0){
  var polling=false;
  setInterval(function(){
    if(polling) return; polling=true;
    fetch('events.jsonl', {headers:{Range:'bytes='+byteOffset+'-'}, cache:'no-store'}).then(function(r){
      if(r.status===416) return null;
      return r.text().then(function(txt){ return {txt:txt, status:r.status}; });
    }).then(function(res){
      polling=false;
      if(!res || !res.txt) return;
      if(res.status===200 && byteOffset>0){
        // server ignored Range: re-read whole file
        var all=[]; res.txt.split('\n').forEach(function(l){ l=l.trim(); if(!l) return; try{all.push(JSON.parse(l));}catch(e){} });
        if(all.length===events.length) return;
        events = all; byteOffset = res.txt.length; renderAll(); return;
      }
      var added=0;
      res.txt.split('\n').forEach(function(l){ l=l.trim(); if(!l) return;
        try{ events.push(JSON.parse(l)); added++; }catch(e){} });
      byteOffset += res.txt.length;
      if(added) renderAll();
    }).catch(function(){ polling=false; });
  }, 3000);
}
})();
`;

function html() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>BLITZ RELOADED — Gauntlet Progress</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="inner">
    <div class="chev"></div>
    <h1>BLITZ RELOADED<small>GAUNTLET</small></h1>
    <span class="pill" id="roundPill">ROUND <b>0</b></span>
    <span class="pill">ELAPSED <b id="elapsed">0h 00m</b></span>
    <div class="counters">
      <div class="counter b"><div class="n" id="cBuild">0</div><div class="l">building</div></div>
      <div class="counter a"><div class="n" id="cWait">0</div><div class="l">awaiting verdict</div></div>
      <div class="counter g"><div class="n" id="cDone">0</div><div class="l">converged</div></div>
      <button id="themeBtn">THEME: AUTO</button>
    </div>
  </div>
</header>

<div class="wrap">
  <h2>Convergence</h2>
  <div class="chartbox"><div id="chart"></div><div class="legend" id="legend"></div></div>

  <h2>The 16-piece board · worst first</h2>
  <div class="board" id="board"></div>

  <h2>Live feed</h2>
  <div class="feed" id="feed"></div>

  <div class="foot">
    generated ${BOOT.generatedAt} · ${BOOT.events.length} events · ${BOOT.shots.length} captures · ${BOOT.inlineNote}<br>
    regenerate: <code>node tools/progress.mjs</code> · serve live: <code>node scripts/serve.mjs --progress</code> → http://127.0.0.1:5179/progress/
  </div>
</div>

<div id="detail">
  <div class="dwrap">
    <div class="dhead">
      <div class="chev"></div>
      <h3 id="dTitle">piece</h3>
      <button id="close">CLOSE</button>
    </div>
    <div class="tools">
      <button id="bDiff">DIFFERENCE</button>
      <button id="bOnion">ONION SKIN 50%</button>
      <span style="color:var(--faint);font-size:12px;align-self:center">drag the gold seam to wipe</span>
    </div>
    <div id="wipeBox">
      <div class="lay" id="dBar"></div>
      <div id="wipeClip"><div class="lay" id="dOurs"></div></div>
      <div id="seam" style="left:50%"></div>
    </div>
    <div class="tl" id="dTl"></div>
  </div>
</div>

<script>window.__BOOT__ = ${JSON.stringify(BOOT).replace(/</g, '\\u003c')};</script>
<script>${CLIENT}</script>
</body>
</html>
`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html());
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`[progress] wrote ${path.relative(REPO, OUT)} (${kb} KB) — ${BOOT.events.length} events, ${BOOT.shots.length} captures, ${BOOT.inlineNote}`);
