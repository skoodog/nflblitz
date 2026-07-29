#!/usr/bin/env python3
"""Ingest the supplied all-time franchise rosters -- the source of truth.

This REPLACES the previous roster layer (tools/build-rosters.py, nflverse 2024
actives with ratings computed here). The supplied workbook is authored data: 32
clubs x 14 players, laid out on the seven-on-seven Blitz slot structure rather
than a 53-man depth chart, with per-player ratings, body/skin presets and a
franchise lineage. Its own README states the ratings are hypothetical peak values
and not official EA Sports ratings.

    python3 tools/build-blitz-rosters.py --xlsx <nfl_blitz_all_time_rosters.xlsx>

Writes:
  src/data/players.json  {meta, byTeam: {ABBR: [player, ...]}}   -- 14 per club
  src/data/depth.json    {ABBR: {group: [name, ...]}}            -- legacy shape
  src/data/blitz.json    {meta, slots, byTeam: {ABBR: {OFF: [...], DEF: [...]}}}

players.json keeps the field names existing pieces already read (name, team, pos,
num, ovr) and carries the Blitz attributes alongside, plus a few legacy aliases,
so brand-identity / uniform-kit / turf-field keep working untouched.
"""
import argparse
import json
import warnings
from collections import defaultdict
from pathlib import Path

warnings.filterwarnings("ignore", module="openpyxl")
import openpyxl  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"

# The seven-on-seven structure, in field order.
OFF_SLOTS = ["QB", "REC1", "REC2", "REC3", "OL1", "OL2", "OL3"]
DEF_SLOTS = ["RUSH1", "RUSH2", "ROVER", "DB1", "DB2", "DB3", "DB4"]

# Blitz slot -> the legacy depth-chart group consumers already read.
GROUP = {
    "QB": "quarterback",
    "REC1": "o_pass", "REC2": "o_pass", "REC3": "o_pass",
    "OL1": "o_line", "OL2": "o_line", "OL3": "o_line",
    "RUSH1": "d_line", "RUSH2": "d_line",
    "ROVER": "d_lb",
    "DB1": "d_field", "DB2": "d_field", "DB3": "d_field", "DB4": "d_field",
}

# Workbook column -> our short key. These eleven are the whole rating model.
ATTRS = {
    "Speed": "spd",
    "Catch": "cth",
    "Run_Strength": "rst",
    "Ball_Security": "bal",
    "Pass": "pas",
    "Block": "blk",
    "Tackle": "tak",
    "Hit_Power": "pow",
    "Coverage": "cov",
    "Interception": "itc",
    "Pass_Rush": "prs",
}

# A few pieces read older key names. Alias ONLY where the old key means the same
# thing as a real Blitz attribute. Deliberately NOT aliased: acc and agi, because
# this rating set has no acceleration or agility axis -- pointing them at spd
# manufactures a second speed column, and a consumer averaging acc and agi then
# gets a bar 0.89-correlated with its own speed bar.
LEGACY = {"str": "rst", "car": "bal", "trk": "rst",
          "mcv": "cov", "zcv": "cov", "pur": "tak", "thp": "pas", "rbk": "blk"}


def norm_abbr(a):
    """Workbook codes -> the ids src/data/teams.json uses."""
    a = (a or "").strip().upper()
    return {"LA": "LAR", "WSH": "WAS", "JAC": "JAX", "SD": "LAC", "OAK": "LV"}.get(a, a)


def num(v, dflt=0):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return dflt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.xlsx, data_only=True)
    rows = list(wb["Roster"].iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(hdr)}

    def cell(r, name):
        i = idx.get(name)
        return r[i] if i is not None and i < len(r) else None

    by_team = defaultdict(list)
    blitz = defaultdict(lambda: {"OFF": {}, "DEF": {}})
    meta_teams = {}
    missing_ovr = []

    for r in rows[1:]:
        if not r or not cell(r, "Player"):
            continue
        abbr = norm_abbr(cell(r, "Team_Abbr"))
        slot = str(cell(r, "Blitz_Slot") or "").strip().upper()
        side = str(cell(r, "Side") or "").strip().lower()
        name = str(cell(r, "Player")).strip()

        p = {
            "name": name,
            "team": abbr,
            "side": "OFF" if side.startswith("off") else "DEF",
            "slot": slot,
            "grp": GROUP.get(slot, "d_field"),
            "pos": str(cell(r, "Native_Position") or "").strip(),
            "num": num(cell(r, "Jersey")),
            "tier": str(cell(r, "Selection_Tier") or "").strip(),
            "arch": str(cell(r, "Rating_Archetype") or "").strip(),
            "skin": str(cell(r, "Skin_Tone_Preset") or "").strip(),
            "body": str(cell(r, "Body_Archetype") or "").strip(),
            "model": str(cell(r, "Model_Preset") or "").strip(),
            "ovr": num(cell(r, "Peak_OVR")),
            "id": str(cell(r, "Roster_Instance_ID") or "").strip(),
        }
        # Ratings are sparse by side in the source -- a lineman has no Coverage.
        # Absent means "not rated for this role", so it stays absent rather than 0.
        for col, key in ATTRS.items():
            v = cell(r, col)
            if v is not None and str(v).strip() != "":
                p[key] = num(v)
        for old, new in LEGACY.items():
            if new in p and old not in p:
                p[old] = p[new]

        if not p["ovr"]:
            missing_ovr.append(f"{abbr}/{slot}/{name}")

        by_team[abbr].append(p)
        blitz[abbr]["OFF" if p["side"] == "OFF" else "DEF"][slot] = name
        meta_teams[abbr] = {
            "name": str(cell(r, "Team") or "").strip(),
            "conf": str(cell(r, "Conference") or "").strip(),
            "div": str(cell(r, "Division") or "").strip(),
            "lineage": str(cell(r, "Franchise_Lineage") or "").strip(),
        }

    # Field order, not rating order: the game lines these up on a formation.
    order = {s: i for i, s in enumerate(OFF_SLOTS + DEF_SLOTS)}
    for abbr in by_team:
        by_team[abbr].sort(key=lambda p: order.get(p["slot"], 99))

    depth = {}
    for abbr, roster in by_team.items():
        g = defaultdict(list)
        for p in roster:
            g[p["grp"]].append(p)
        depth[abbr] = {k: [x["name"] for x in sorted(v, key=lambda p: -p["ovr"])]
                       for k, v in sorted(g.items())}

    meta = {
        "league": "NFL",
        "source": Path(a.xlsx).name,
        "structure": "7-on-7 Blitz slots",
        "offSlots": OFF_SLOTS,
        "defSlots": DEF_SLOTS,
        "attrKeys": sorted(set(ATTRS.values())),
        "note": (
            "Authored all-time franchise rosters supplied as the source of truth. "
            "Per the workbook's own README, ratings are hypothetical peak values and "
            "are not official EA Sports ratings. Absent ratings mean the attribute is "
            "not rated for that role, not zero."
        ),
        "teams": meta_teams,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "players.json").write_text(json.dumps({"meta": meta, "byTeam": dict(by_team)}))
    (OUT / "depth.json").write_text(json.dumps(depth, indent=1))
    (OUT / "blitz.json").write_text(json.dumps(
        {"meta": {"offSlots": OFF_SLOTS, "defSlots": DEF_SLOTS},
         "byTeam": {k: v for k, v in blitz.items()}}, indent=1))

    tot = sum(len(v) for v in by_team.values())
    print(f"[blitz] {len(by_team)} clubs, {tot} players -> src/data/")
    bad = [t for t, v in by_team.items() if len(v) != 14]
    if bad:
        print(f"   CLUBS NOT AT 14: {', '.join(f'{t}={len(by_team[t])}' for t in bad)}")
    if missing_ovr:
        print(f"   MISSING Peak_OVR ({len(missing_ovr)}): {', '.join(missing_ovr[:8])}")


if __name__ == "__main__":
    main()
