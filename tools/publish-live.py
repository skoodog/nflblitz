#!/usr/bin/env python3
"""Build progress/live.html -- the lean, shareable view of the gauntlet.

The in-repo progress/index.html (built by tools/progress.mjs) is the full-fidelity
local board: it inlines every capture at full resolution and is far too heavy to
publish. This reads the same progress/events.jsonl, downscales the captures, and
emits a single self-contained page small enough to host.

    python3 tools/publish-live.py
"""
import base64, io, json, os, re, sys
from collections import OrderedDict
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ROOT / "progress" / "events.jsonl"
PLAN = ROOT / ".gauntlet-plan.json"
OUT = ROOT / "progress" / "live.html"
WIN = 88

# ---------------------------------------------------------------- assets ----

def subset_font():
    """FreeSansBoldOblique, subset to the glyphs the board uses, as woff2.

    The bar's lettering is a heavy brush italic; an oblique bold grotesque is the
    closest thing on this box and carries the same scoreboard voice.
    """
    from fontTools import subset
    src = Path("/usr/share/fonts/truetype/freefont/FreeSansBoldOblique.ttf")
    if not src.exists():
        return None
    buf = io.BytesIO()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.layout_features = ["kern", "liga"]
    font = subset.load_font(str(src), opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(text=(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "abcdefghijklmnopqrstuvwxyz"
        "0123456789 .,:;!?/()[]-–—'’\"&%+#·→"
    ))
    subsetter.subset(font)
    subset.save_font(font, buf, opts)
    return base64.b64encode(buf.getvalue()).decode()


def thumb(path, width, quality=72):
    """Downscale a capture to a data: URI. Returns (uri, w, h) or None."""
    p = ROOT / path
    if not p.exists() or not p.is_file():
        return None
    try:
        im = Image.open(p).convert("RGB")
    except Exception:
        return None
    if im.width > width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=5)
    return ("data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode(), im.width, im.height)


# ------------------------------------------------------------------ data ----

def load_events():
    if not EVENTS.exists():
        return []
    out = []
    for line in EVENTS.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def load_plan():
    if not PLAN.exists():
        return {}
    try:
        raw = json.loads(PLAN.read_text())
    except json.JSONDecodeError:
        return {}
    plan = raw.get("plan", raw)
    return {p["id"]: p for p in plan.get("pieces", [])}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def collect():
    """Fold the event log into per-piece, per-round state."""
    pieces = OrderedDict()
    for meta_id, meta in load_plan().items():
        pieces[meta_id] = {
            "id": meta_id,
            "name": meta.get("name", meta_id),
            "panels": meta.get("barPanels", []),
            "judgeOn": meta.get("judgeOn", ""),
            "rounds": OrderedDict(),
        }

    for e in load_events():
        pid = e.get("piece")
        if not pid or pid == "foundation":
            continue
        pc = pieces.setdefault(pid, {"id": pid, "name": pid, "panels": [], "judgeOn": "", "rounds": OrderedDict()})
        r = int(e.get("round") or 0)
        rd = pc["rounds"].setdefault(r, {"round": r, "score": None, "gap": None, "shots": [], "cmp": None, "notes": []})
        score = num(e.get("score"))
        if score is not None:
            rd["score"] = score
        for key in ("gap", "text", "note"):
            val = e.get(key)
            if key == "gap" and val:
                rd["gap"] = val
            elif val and key != "gap":
                rd["notes"].append(str(val))
        shot = e.get("shot")
        if shot and shot not in rd["shots"]:
            rd["shots"].append(shot)
        if e.get("cmp"):
            rd["cmp"] = e["cmp"]

    # fall back to whatever captures exist on disk for pieces that logged none
    for pid, pc in pieces.items():
        d = ROOT / "shots" / pid
        if not d.is_dir():
            continue
        found = sorted(str(f.relative_to(ROOT)) for f in d.glob("*.png"))
        if not found:
            continue
        known = {s for rd in pc["rounds"].values() for s in rd["shots"]}
        extra = [f for f in found if f not in known]
        if not extra:
            continue
        r = max(pc["rounds"]) if pc["rounds"] else 1
        rd = pc["rounds"].setdefault(r, {"round": r, "score": None, "gap": None, "shots": [], "cmp": None, "notes": []})
        for f in extra:
            rd["shots"].append(f)
    return pieces


# ------------------------------------------------------------------ view ----

def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def score_color(s):
    if s is None:
        return "var(--dim)"
    if s >= WIN:
        return "var(--win)"
    if s >= 70:
        return "var(--gold)"
    return "var(--red)"


def ring(score, size=54):
    r = (size - 8) / 2
    circ = 2 * 3.14159265 * r
    pct = 0 if score is None else max(0.0, min(1.0, score / 100.0))
    c = size / 2
    return (
        f'<svg class="ring" viewBox="0 0 {size} {size}" width="{size}" height="{size}" aria-hidden="true">'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="var(--line)" stroke-width="4"/>'
        f'<circle cx="{c}" cy="{c}" r="{r}" fill="none" stroke="{score_color(score)}" stroke-width="4"'
        f' stroke-linecap="round" stroke-dasharray="{circ*pct:.1f} {circ:.1f}"'
        f' transform="rotate(-90 {c} {c})"/></svg>'
    )


def sparkline(scores):
    """Score across rounds -- the shape of the loop actually working, or not."""
    pts = [s for s in scores if s is not None]
    if len(pts) < 2:
        return ""
    w, h, pad = 108, 34, 4
    lo, hi = min(pts + [40]), max(pts + [100])
    span = max(1.0, hi - lo)
    step = (w - pad * 2) / (len(pts) - 1)
    coords = [(pad + i * step, h - pad - (v - lo) / span * (h - pad * 2)) for i, v in enumerate(pts)]
    d = " ".join(("M" if i == 0 else "L") + f"{x:.1f} {y:.1f}" for i, (x, y) in enumerate(coords))
    last = coords[-1]
    return (
        f'<svg class="spark" viewBox="0 0 {w} {h}" width="{w}" height="{h}" aria-hidden="true">'
        f'<path d="{d}" fill="none" stroke="{score_color(pts[-1])}" stroke-width="2"'
        f' stroke-linejoin="round" stroke-linecap="round"/>'
        f'<circle cx="{last[0]:.1f}" cy="{last[1]:.1f}" r="2.6" fill="{score_color(pts[-1])}"/></svg>'
    )


def build():
    pieces = collect()
    font_b64 = subset_font()

    panels = {}
    for p in sorted((ROOT / "bar").glob("panel-*.png")):
        t = thumb(str(p.relative_to(ROOT)), 520)
        if t:
            panels[p.name] = t[0]

    rows, cards = [], []
    scored = []
    total_rounds = 0

    for pc in pieces.values():
        rounds = [pc["rounds"][k] for k in sorted(pc["rounds"])]
        rounds = [r for r in rounds if r["round"] > 0] or rounds
        total_rounds += len([r for r in rounds if r["score"] is not None])
        scores = [r["score"] for r in rounds]
        latest = next((s for s in reversed(scores) if s is not None), None)
        if latest is not None:
            scored.append(latest)
        gap = next((r["gap"] for r in reversed(rounds) if r["gap"]), None)
        state = "won" if (latest is not None and latest >= WIN) else ("live" if latest is not None else "queued")
        label = {"won": "CLEARED", "live": "IN GAUNTLET", "queued": "QUEUED"}[state]

        strip = []
        for r in rounds:
            for s in r["shots"][:3]:
                t = thumb(s, 208)
                if not t:
                    continue
                strip.append(
                    f'<button class="fr" data-full="{esc(r.get("cmp") or s)}" data-piece="{esc(pc["id"])}"'
                    f' data-round="{r["round"]}" title="round {r["round"]} · {esc(os.path.basename(s))}">'
                    f'<img src="{t[0]}" alt="{esc(pc["name"])} round {r["round"]} capture" loading="lazy"/>'
                    f'<span class="rn">R{r["round"]}</span></button>'
                )
        if not strip:
            strip.append('<div class="fr empty">no capture yet</div>')

        rows.append(f"""
      <article class="piece {state}" id="p-{esc(pc['id'])}">
        <div class="head">
          {ring(latest)}
          <div class="idc">
            <h3>{esc(pc['name'])}</h3>
            <p class="slug">{esc(pc['id'])}</p>
          </div>
          <div class="meta">
            <span class="tag t-{state}">{label}</span>
            <span class="sc" style="color:{score_color(latest)}">{'--' if latest is None else int(latest)}<i>/100</i></span>
            {sparkline(scores)}
          </div>
        </div>
        {'<blockquote class="gap"><span class="qh">Critic &middot; biggest remaining gap</span>' + esc(gap) + '</blockquote>' if gap else ''}
        <div class="strip">{''.join(strip)}</div>
      </article>""")

    won = len([s for s in scored if s >= WIN])
    avg = round(sum(scored) / len(scored)) if scored else 0
    stats = [
        ("PIECES", len(pieces)),
        ("CLEARED", won),
        ("ROUNDS JUDGED", total_rounds),
        ("MEAN SCORE", avg if scored else "--"),
    ]
    statc = "".join(
        f'<div class="stat"><span class="sv">{v}</span><span class="sl">{l}</span></div>' for l, v in stats
    )

    barstrip = "".join(
        f'<button class="bp" data-full="{esc(n)}"><img src="{u}" alt="{esc(n)}" loading="lazy"/></button>'
        for n, u in panels.items()
    )

    fullmap = {}
    for pc in pieces.values():
        for r in pc["rounds"].values():
            for s in ([r["cmp"]] if r["cmp"] else []) + r["shots"]:
                if s and s not in fullmap:
                    t = thumb(s, 1180, quality=76)
                    if t:
                        fullmap[s] = t[0]
    for n, u in panels.items():
        fullmap.setdefault(n, u)

    fontface = (
        f"@font-face{{font-family:'Board';src:url(data:font/woff2;base64,{font_b64}) format('woff2');"
        "font-weight:700;font-style:normal;font-display:swap}" if font_b64 else ""
    )

    return f"""<title>Blitz Reloaded &middot; Gauntlet Board</title>
<style>
{fontface}
/* A stadium scoreboard at night: this page deliberately commits to one theme,
   because the subject is a night game and a light board would be a different object. */
:root{{
  --ground:#080A0E; --panel:#12161D; --panel2:#171C25; --line:#242C38;
  --text:#E9ECF2; --dim:#7E8A9C; --faint:#4C5766;
  --gold:#F5B92E; --red:#DF2338; --win:#41A45E;
  --display:'Board',system-ui,sans-serif;
  --body:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--text);font-family:var(--body);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}}
body:before{{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(120% 80% at 50% -10%,rgba(245,185,46,.09),transparent 60%),
             radial-gradient(90% 60% at 12% 0%,rgba(223,35,56,.07),transparent 55%)}}
.wrap{{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:0 22px 96px}}

header{{padding:56px 0 30px;border-bottom:1px solid var(--line)}}
.eyebrow{{font-family:var(--display);font-size:12px;letter-spacing:.22em;color:var(--red);margin:0 0 14px}}
h1{{font-family:var(--display);font-size:clamp(38px,7vw,68px);line-height:.94;margin:0;
  letter-spacing:-.01em;text-wrap:balance;
  background:linear-gradient(180deg,#FFF 8%,#C9D1DE 46%,#7C8798 62%,#EEF2F8 90%);
  -webkit-background-clip:text;background-clip:text;color:transparent}}
.sub{{color:var(--dim);max-width:62ch;margin:16px 0 0;font-size:15.5px}}
.sub b{{color:var(--text);font-weight:600}}

.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin:30px 0 0}}
.stat{{background:var(--panel);padding:16px 18px;display:flex;flex-direction:column;gap:3px}}
.sv{{font-family:var(--display);font-size:30px;line-height:1;font-variant-numeric:tabular-nums}}
.sl{{font-size:10.5px;letter-spacing:.16em;color:var(--faint)}}

section{{margin:52px 0 0}}
h2{{font-family:var(--display);font-size:13px;letter-spacing:.2em;color:var(--dim);
  margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid var(--line)}}

.barstrip{{display:flex;gap:8px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin}}
.bp{{flex:0 0 auto;width:150px;padding:0;border:1px solid var(--line);border-radius:7px;
  overflow:hidden;background:var(--panel);cursor:zoom-in;transition:border-color .16s,transform .16s}}
.bp:hover,.bp:focus-visible{{border-color:var(--gold);transform:translateY(-2px)}}
.bp img{{display:block;width:100%;height:auto}}

.ladder{{display:flex;flex-direction:column;gap:12px}}
.piece{{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px 16px;
  border-left:3px solid var(--faint)}}
.piece.won{{border-left-color:var(--win)}}
.piece.live{{border-left-color:var(--gold)}}
.head{{display:flex;align-items:center;gap:15px;flex-wrap:wrap}}
.ring{{flex:0 0 auto}}
.idc{{min-width:0;flex:1 1 240px}}
.idc h3{{font-family:var(--display);font-size:20px;margin:0;letter-spacing:.005em}}
.slug{{margin:2px 0 0;font-size:11.5px;color:var(--faint);font-family:ui-monospace,monospace}}
.meta{{display:flex;align-items:center;gap:14px;margin-left:auto}}
.tag{{font-size:9.5px;letter-spacing:.15em;padding:4px 9px;border-radius:99px;border:1px solid var(--line);color:var(--dim)}}
.t-won{{color:var(--win);border-color:rgba(65,164,94,.42)}}
.t-live{{color:var(--gold);border-color:rgba(245,185,46,.38)}}
.sc{{font-family:var(--display);font-size:27px;font-variant-numeric:tabular-nums;line-height:1}}
.sc i{{font-size:12px;font-style:normal;color:var(--faint)}}
.spark{{flex:0 0 auto}}

.gap{{margin:15px 0 0;padding:12px 15px;background:var(--panel2);border-left:2px solid var(--red);
  border-radius:0 7px 7px 0;font-size:14px;color:#CFD6E1}}
.qh{{display:block;font-size:9.5px;letter-spacing:.15em;color:var(--faint);margin-bottom:5px;
  font-family:var(--display)}}

.strip{{display:flex;gap:8px;overflow-x:auto;margin-top:15px;padding-bottom:6px;scrollbar-width:thin}}
.fr{{position:relative;flex:0 0 auto;width:132px;padding:0;border:1px solid var(--line);
  border-radius:6px;overflow:hidden;background:var(--ground);cursor:zoom-in;
  transition:border-color .16s,transform .16s}}
.fr:hover,.fr:focus-visible{{border-color:var(--gold);transform:translateY(-2px)}}
.fr img{{display:block;width:100%;height:auto}}
.fr.empty{{display:grid;place-items:center;height:74px;font-size:10.5px;color:var(--faint);cursor:default}}
.rn{{position:absolute;left:0;bottom:0;font-family:var(--display);font-size:9.5px;
  padding:2px 5px;background:rgba(8,10,14,.82);color:var(--gold);letter-spacing:.08em}}

#lb{{position:fixed;inset:0;z-index:50;display:none;place-items:center;padding:28px;
  background:rgba(4,5,8,.94);backdrop-filter:blur(6px)}}
#lb.on{{display:grid}}
#lb img{{max-width:100%;max-height:88vh;border-radius:8px;border:1px solid var(--line)}}
#lb .cap{{position:absolute;left:0;right:0;bottom:16px;text-align:center;font-size:12px;
  color:var(--dim);font-family:var(--display);letter-spacing:.12em}}
#lb button{{position:absolute;top:18px;right:22px;background:none;border:0;color:var(--dim);
  font-size:30px;line-height:1;cursor:pointer}}
:focus-visible{{outline:2px solid var(--gold);outline-offset:2px}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
@media (max-width:620px){{.meta{{margin-left:0;width:100%}}header{{padding-top:38px}}}}
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">GAUNTLET LOOP &middot; LIVE BOARD</p>
    <h1>BLITZ RELOADED</h1>
    <p class="sub">Every piece gets a builder and an independent critic with fresh context. The critic
    captures the <b>real rendered output</b>, puts it beside the concept art at matched scale, names the
    single most obvious tell, and sends it back. A piece clears at <b>{WIN}/100</b>. The loop runs until
    the output wins.</p>
    <div class="stats">{statc}</div>
  </header>

  <section>
    <h2>THE BAR</h2>
    <div class="barstrip">{barstrip}</div>
  </section>

  <section>
    <h2>PIECES</h2>
    <div class="ladder">{''.join(rows)}</div>
  </section>
</div>

<div id="lb" role="dialog" aria-modal="true" aria-label="Capture viewer">
  <button id="lbx" aria-label="Close">&times;</button>
  <img id="lbi" alt=""/>
  <p class="cap" id="lbc"></p>
</div>

<script>
const FULL = {json.dumps(fullmap)};
const lb = document.getElementById('lb'), lbi = document.getElementById('lbi'), lbc = document.getElementById('lbc');
function open(src, cap) {{
  const u = FULL[src]; if (!u) return;
  lbi.src = u; lbi.alt = cap; lbc.textContent = cap; lb.classList.add('on');
}}
function close() {{ lb.classList.remove('on'); lbi.src = ''; }}
document.querySelectorAll('.fr[data-full],.bp[data-full]').forEach(b => {{
  b.addEventListener('click', () => {{
    const p = b.dataset.piece, r = b.dataset.round;
    open(b.dataset.full, p ? p + ' \\u00b7 round ' + r : b.dataset.full.replace('panel-', '').replace('.png', ''));
  }});
}});
document.getElementById('lbx').addEventListener('click', close);
lb.addEventListener('click', e => {{ if (e.target === lb) close(); }});
addEventListener('keydown', e => {{ if (e.key === 'Escape') close(); }});
</script>
"""


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    html = build()
    OUT.write_text(html)
    print(f"[publish-live] wrote {OUT.relative_to(ROOT)} ({len(html)//1024} KB)")
