#!/usr/bin/env node
// FOUNDATION — FROZEN after t=0. Do not edit.
//
// FAILS THE BUILD on non-determinism under src/pieces/.
// Two runs of the same capture URL must produce byte-identical PNGs. Anything that
// reads a wall clock or an unseeded RNG breaks that, which breaks every critic loop.
//
//   node scripts/lint-determinism.mjs
//   node scripts/lint-determinism.mjs --path=src/pieces/turf-field
//
// Allowed instead:
//   makeRng(seed) / hash() / hash01()   from src/foundation/rng.js
//   the simulated time `t` passed into build/update/draw
//
// A line may opt out with a trailing `// determinism-ok: <reason>` comment, but the
// reason must be real — a critic will read it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const RULES = [
  { re: /\bMath\s*\.\s*random\s*\(/g, msg: 'Math.random() — use makeRng(seed) from foundation/rng.js' },
  { re: /\bDate\s*\.\s*now\s*\(/g, msg: 'Date.now() — animation must be a pure function of the simulated time t' },
  { re: /\bperformance\s*\.\s*now\s*\(/g, msg: 'performance.now() — animation must be a pure function of t' },
  { re: /\bnew\s+Date\s*\(\s*\)/g, msg: 'new Date() — wall clock' },
  { re: /\bcrypto\s*\.\s*getRandomValues\s*\(/g, msg: 'crypto.getRandomValues() — unseeded randomness' },
  { re: /\bcrypto\s*\.\s*randomUUID\s*\(/g, msg: 'crypto.randomUUID() — unseeded randomness' },
  { re: /\bsetTimeout\s*\(/g, msg: 'setTimeout() — capture is single-shot; make it a function of t', warn: true },
  { re: /\bsetInterval\s*\(/g, msg: 'setInterval() — capture is single-shot; make it a function of t', warn: true },
  { re: /\brequestAnimationFrame\s*\(/g, msg: 'requestAnimationFrame() — the engine owns the loop', warn: true },
];

function args() {
  const o = {};
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    if (i < 0) o[a.slice(2)] = true; else o[a.slice(2, i)] = a.slice(i + 1);
  }
  return o;
}
const A = args();
const TARGET = path.resolve(REPO, (A.path && A.path !== true) ? String(A.path) : 'src/pieces');

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(m?js|jsx|glsl|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Strip block/line comments and string literals so we don't flag docs. */
function scrub(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';
  let quote = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (state === 'str') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) { state = 'code'; out += ' '; i++; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
  }
  return out;
}

const files = walk(TARGET);
const errors = [];
const warnings = [];

for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  const code = scrub(raw);
  const rawLines = raw.split('\n');
  const codeLines = code.split('\n');
  for (const rule of RULES) {
    for (let li = 0; li < codeLines.length; li++) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(codeLines[li])) continue;
      if (/\/\/\s*determinism-ok\b/.test(rawLines[li] || '')) continue;
      const rec = {
        file: path.relative(REPO, f),
        line: li + 1,
        msg: rule.msg,
        src: (rawLines[li] || '').trim().slice(0, 120),
      };
      (rule.warn ? warnings : errors).push(rec);
    }
  }
}

for (const w of warnings) {
  console.warn(`WARN  ${w.file}:${w.line}  ${w.msg}\n        ${w.src}`);
}
for (const e of errors) {
  console.error(`ERROR ${e.file}:${e.line}  ${e.msg}\n        ${e.src}`);
}

console.log(`\n[lint-determinism] scanned ${files.length} files under ${path.relative(REPO, TARGET) || '.'} — ${errors.length} error(s), ${warnings.length} warning(s)`);
if (errors.length) {
  console.error('\nDETERMINISM LINT FAILED. Two runs of the same capture URL must produce byte-identical PNGs.');
  process.exit(1);
}
