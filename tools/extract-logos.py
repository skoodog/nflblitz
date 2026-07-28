#!/usr/bin/env python3
"""Cut the 32 club marks out of the supplied 4-across logo sheet.

The sheet is a 4 x 8 grid on a black field. Naively keying out every black pixel
would gut the marks that are legitimately black -- Raiders, Saints, Ravens,
Jaguars, Steelers, Bengals, Panthers all carry black as an ink -- so the
background is removed by flood-filling inward from each cell's border. Interior
black is connected to the mark, not to the border, and survives.

    python3 tools/extract-logos.py --sheet <sheet.png>
    python3 tools/extract-logos.py --sheet <sheet.png> --contact   # QA contact sheet

Writes bar/logos/<ABBR>.png, trimmed to the mark with a transparent surround.
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


def is_bg(px, thresh):
    """Near-black and near-neutral: the sheet's field, not a club's black ink."""
    r, g, b = px[0], px[1], px[2]
    return max(r, g, b) <= thresh


def key_background(cell, thresh=42):
    """Alpha out only the black REGION CONNECTED TO THE BORDER."""
    cell = cell.convert("RGBA")
    w, h = cell.size
    px = cell.load()

    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not seen[i] and is_bg(px[x, y], thresh):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", required=True, help="path to the 4x8 logo sheet")
    ap.add_argument("--thresh", type=int, default=42, help="background luminance cutoff")
    ap.add_argument("--contact", action="store_true", help="also write a QA contact sheet")
    ap.add_argument("--include-was", action="store_true",
                    help="also extract the Washington cell (retired mark; off by default)")
    a = ap.parse_args()

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
        keyed = trim(key_background(cell, a.thresh))
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
