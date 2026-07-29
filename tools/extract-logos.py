#!/usr/bin/env python3
"""Cut the club marks out of a supplied logo sheet.

Two sheet layouts are supported, because the two sheets received are different:

  --mode=grid   a regular R x C grid, one mark per cell (the 4x8 black sheet)
  --mode=blob   marks scattered at arbitrary positions and scales (the white sheet)

Both share the same background removal, and it is deliberately NOT a global colour
key. Keying every black pixel would gut Raiders, Saints, Ravens, Jaguars, Steelers,
Bengals and Panthers; keying every white pixel would gut the Jets lettering, the
Steelers circle, the Raiders shield and the Cowboys star's surround. Instead the
background is removed by flood-filling INWARD FROM THE BORDER. Ink that belongs to a
mark is enclosed by the mark, not connected to the border, so it survives either way.

In blob mode the marks are then found as connected components of remaining ink, so
overlapping and irregular placement is fine. Components are emitted numbered, in
reading order, with a numbered contact sheet -- because a blob has no name. Map the
numbers to club abbreviations with --map once you have looked at the contact sheet.

    python3 tools/extract-logos.py --sheet <s.png> --mode=blob --bg=white --contact
    python3 tools/extract-logos.py --sheet <s.png> --mode=blob --bg=white --map=map.json
    python3 tools/extract-logos.py --sheet <s.png> --mode=grid --bg=black --contact

Writes bar/logos/<ABBR>.png (or blob-##.png before mapping), trimmed, transparent.
"""
import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "bar" / "logos"

# Reading order of the supplied sheet: 4 across, 8 down, NFC then AFC by division.
ORDER = [
    "DAL", "NYG", "PHI", "WAS",
    "CHI", "DET", "GB",  "MIN",
    "ATL", "CAR", "NO",  "TB",
    "ARI", "LAR", "SF",  "SEA",
    "BUF", "MIA", "NE",  "NYJ",
    "BAL", "CIN", "CLE", "PIT",
    "HOU", "IND", "JAX", "TEN",
    "DEN", "KC",  "LV",  "LAC",
]
COLS, ROWS = 4, 8

# The supplied sheet carries the RETIRED Washington mark in the WAS cell. The
# club is the Commanders, so that cell is skipped and Washington falls through to
# the procedural crest -- a 'W' monogram in burgundy and gold, which is the
# current mark. Pass --include-was to override.
SKIP_DEFAULT = {"WAS"}


def is_bg(px, thresh, bg):
    """Is this pixel the sheet's FIELD colour (not necessarily background)?

    Only meaningful together with the border flood fill -- a mark's own black or
    white is the same colour as the field and is separated by connectivity, not
    by this test.
    """
    r, g, b = px[0], px[1], px[2]
    if bg == "white":
        return min(r, g, b) >= thresh
    return max(r, g, b) <= thresh


def key_background(cell, thresh=42, bg="black"):
    """Alpha out only the field REGION CONNECTED TO THE BORDER."""
    cell = cell.convert("RGBA")
    w, h = cell.size
    px = cell.load()

    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not seen[i] and is_bg(px[x, y], thresh, bg):
            seen[i] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h:
                push(nx, ny)

    for y in range(h):
        base = y * w
        for x in range(w):
            if seen[base + x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    return cell


def trim(im, pad=2):
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        return None
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(im.width, r + pad), min(im.height, b + pad)
    return im.crop((l, t, r, b))


def components(alpha, w, h, min_px):
    """Connected components of non-transparent ink, 8-connected.

    8-connected on purpose: many marks are drawn with hairline diagonal joins
    (the Bills' stripe, the Falcons' wing, the Chargers' bolt), and 4-connectivity
    splits those into pieces that then get emitted as separate blobs.
    """
    lab = [0] * (w * h)
    boxes = []
    n = 0
    for sy in range(h):
        for sx in range(w):
            i0 = sy * w + sx
            if lab[i0] or alpha[i0] == 0:
                continue
            n += 1
            q = deque([(sx, sy)])
            lab[i0] = n
            x0 = x1 = sx
            y0 = y1 = sy
            count = 0
            while q:
                x, y = q.popleft()
                count += 1
                if x < x0: x0 = x
                if x > x1: x1 = x
                if y < y0: y0 = y
                if y > y1: y1 = y
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h:
                            j = ny * w + nx
                            if not lab[j] and alpha[j]:
                                lab[j] = n
                                q.append((nx, ny))
            if count >= min_px:
                boxes.append({"id": n, "box": (x0, y0, x1 + 1, y1 + 1), "px": count})
    return lab, boxes


def merge_overlapping(boxes, gap):
    """Marks made of separated parts (the Bills stripe, the Colts horseshoe ends,
    dotted lettering) arrive as several components. Merge boxes that touch or sit
    within `gap` pixels of each other, repeatedly, until stable."""
    changed = True
    while changed:
        changed = False
        out = []
        for b in boxes:
            hit = None
            for o in out:
                ax0, ay0, ax1, ay1 = b["box"]
                bx0, by0, bx1, by1 = o["box"]
                if ax0 - gap < bx1 and bx0 - gap < ax1 and ay0 - gap < by1 and by0 - gap < ay1:
                    hit = o
                    break
            if hit:
                ax0, ay0, ax1, ay1 = b["box"]
                bx0, by0, bx1, by1 = hit["box"]
                hit["box"] = (min(ax0, bx0), min(ay0, by0), max(ax1, bx1), max(ay1, by1))
                hit["px"] += b["px"]
                hit["ids"] = hit.get("ids", [hit["id"]]) + [b["id"]]
                changed = True
            else:
                out.append(dict(b))
        boxes = out
    return boxes


def extract_blobs(sheet, a):
    """Scattered-layout mode: key the whole sheet, then cut each mark as a component."""
    keyed = key_background(sheet, a.thresh, a.bg)
    w, h = keyed.size
    alpha = keyed.getchannel("A").tobytes()
    min_px = max(64, int(w * h * a.minarea))

    _, boxes = components(alpha, w, h, min_px)
    boxes = merge_overlapping(boxes, a.gap)
    boxes = [b for b in boxes if b["px"] >= min_px]
    # Reading order: banded by row so a scattered sheet still enumerates sanely.
    band = max(1, int(h * a.band))
    boxes.sort(key=lambda b: (b["box"][1] // band, b["box"][0]))

    OUT.mkdir(parents=True, exist_ok=True)
    mapping = {}
    if a.map:
        mapping = json.loads(Path(a.map).read_text())

    made, cuts = {}, []
    for i, b in enumerate(boxes):
        x0, y0, x1, y1 = b["box"]
        im = trim(keyed.crop((x0, y0, x1, y1)))
        if im is None:
            continue
        name = mapping.get(str(i)) or mapping.get(str(i + 1))
        fn = f"{name}.png" if name else f"blob-{i:02d}.png"
        im.save(OUT / fn)
        made[name or f"blob-{i:02d}"] = im.size
        cuts.append({"i": i, "name": name, "box": [x0, y0, x1, y1], "px": b["px"], "size": list(im.size)})

    (OUT / "index.json").write_text(json.dumps(
        {"source": Path(a.sheet).name, "mode": "blob", "bg": a.bg, "cuts": cuts}, indent=1))

    named = sum(1 for c in cuts if c["name"])
    print(f"[logos] {len(cuts)} marks found ({named} named, {len(cuts) - named} unnamed) -> bar/logos/")
    for c in cuts:
        print(f"   {c['i']:2d} {(c['name'] or '-'):5s} {c['size'][0]:4d}x{c['size'][1]:<4d} px={c['px']}")
    if not a.map:
        print("   NOTE: no --map given, so marks are numbered, not named. Look at the contact")
        print("         sheet, write {\"0\":\"DAL\", ...} to a json file, and re-run with --map.")
    return cuts


def contact_blob(cuts, tile=200, cols=6):
    rows = (len(cuts) + cols - 1) // cols
    from PIL import ImageDraw
    sheet = Image.new("RGBA", (cols * tile, rows * tile), (18, 20, 26, 255))
    d = ImageDraw.Draw(sheet)
    for i, c in enumerate(cuts):
        fn = f"{c['name']}.png" if c["name"] else f"blob-{c['i']:02d}.png"
        p = OUT / fn
        if not p.exists():
            continue
        im = Image.open(p)
        k = min((tile - 34) / im.width, (tile - 34) / im.height)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        x = (i % cols) * tile + (tile - im.width) // 2
        y = (i // cols) * tile + (tile - im.height) // 2 + 8
        sheet.alpha_composite(im, (x, y))
        d.text(((i % cols) * tile + 7, (i // cols) * tile + 5),
               f"{c['i']}  {c['name'] or ''}", fill=(245, 185, 46))
    out = ROOT / "shots" / "logo-contact.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(f"[logos] contact sheet -> {out.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="path to the logo sheet")
    ap.add_argument("--mode", choices=["grid", "blob"], default="grid",
                    help="grid = regular cells; blob = scattered/overlapping marks")
    ap.add_argument("--bg", choices=["black", "white"], default="black",
                    help="the sheet's field colour")
    ap.add_argument("--thresh", type=int, default=None,
                    help="field cutoff; defaults to 42 on black, 225 on white")
    ap.add_argument("--minarea", type=float, default=0.0006,
                    help="blob mode: ignore components smaller than this fraction of the sheet")
    ap.add_argument("--gap", type=int, default=14,
                    help="blob mode: merge components within this many px of each other")
    ap.add_argument("--band", type=float, default=0.10,
                    help="blob mode: row-band height, as a fraction of sheet height, for ordering")
    ap.add_argument("--map", default=None,
                    help="blob mode: json {\"0\":\"DAL\", ...} mapping blob index -> club abbr")
    ap.add_argument("--contact", action="store_true", help="also write a QA contact sheet")
    ap.add_argument("--include-was", action="store_true",
                    help="grid mode: also extract the Washington cell (retired mark; off by default)")
    a = ap.parse_args()

    if a.thresh is None:
        a.thresh = 225 if a.bg == "white" else 42

    if a.mode == "blob":
        cuts = extract_blobs(Image.open(a.sheet).convert("RGBA"), a)
        if a.contact:
            contact_blob(cuts)
        return

    sheet = Image.open(a.sheet).convert("RGBA")
    W, H = sheet.size
    cw, ch = W // COLS, H // ROWS
    OUT.mkdir(parents=True, exist_ok=True)

    skip = set() if a.include_was else SKIP_DEFAULT
    made, empty, skipped = {}, [], []
    for i, abbr in enumerate(ORDER):
        if abbr in skip:
            skipped.append(abbr)
            continue
        c, r = i % COLS, i // COLS
        cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        keyed = trim(key_background(cell, a.thresh, a.bg))
        if keyed is None:
            empty.append(abbr)
            continue
        keyed.save(OUT / f"{abbr}.png")
        made[abbr] = keyed.size

    (OUT / "index.json").write_text(json.dumps(
        {"source": Path(a.sheet).name, "grid": [COLS, ROWS], "order": ORDER,
         "sizes": {k: list(v) for k, v in made.items()}}, indent=1))

    print(f"[logos] {len(made)}/{32 - len(skipped)} -> bar/logos/")
    for abbr, size in made.items():
        print(f"   {abbr:4s} {size[0]:4d}x{size[1]:<4d}")
    if empty:
        print(f"   EMPTY (nothing above threshold): {', '.join(empty)}")
    if skipped:
        print(f"   SKIPPED (retired mark, uses procedural crest): {', '.join(skipped)}")

    if a.contact:
        tile = 190
        sheet_out = Image.new("RGBA", (COLS * tile, ROWS * tile), (18, 20, 26, 255))
        for i, abbr in enumerate(ORDER):
            p = OUT / f"{abbr}.png"
            if not p.exists():
                continue  # skipped or empty; procedural crest covers it
            im = Image.open(p)
            k = min((tile - 22) / im.width, (tile - 22) / im.height)
            im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            x = (i % COLS) * tile + (tile - im.width) // 2
            y = (i // COLS) * tile + (tile - im.height) // 2
            sheet_out.alpha_composite(im, (x, y))
        out = ROOT / "shots" / "logo-contact.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet_out.save(out)
        print(f"[logos] contact sheet -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
