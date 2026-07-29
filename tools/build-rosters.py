#!/usr/bin/env python3
"""Build real NFL rosters, with ratings generated here rather than copied.

Roster FACTS come from nflverse's public weekly-roster release: player name,
club, position, depth-chart position, jersey number, height, weight, years of
experience. Those are factual roster records.

Attribute RATINGS are computed by this file from position, physicals and
experience. They are deliberately NOT taken from any published ratings product --
an earlier version of this data layer carried a scraped third-party ratings dump,
which is not restored. The model here is transparent and tunable, which an opaque
copied table would not be.

    python3 tools/build-rosters.py --csv <roster_weekly_YYYY.csv>
    python3 tools/build-rosters.py --csv <csv> --season 2024

Writes src/data/players.json and src/data/depth.json. Club identity lives in
src/data/teams.json (tools/build-league-data.py) and is not touched here.
"""
import argparse
import csv
import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"
SEED = 20260729

# nflverse club codes -> ours. Only the Rams differ.
TEAM_FIX = {"LA": "LAR"}

# How many of each position the game carries, and the jersey range it expects.
# Matches the group names every consumer already reads.
SHAPE = [
    ("QB", "quarterback",   3),
    ("RB", "o_rush",        5),
    ("WR", "o_pass",        9),
    ("TE", "o_te",          4),
    ("OL", "o_line",       10),
    ("DL", "d_line",        9),
    ("LB", "d_lb",          8),
    ("DB", "d_field",      10),
    ("K",  "special_teams", 1),
    ("P",  "special_teams", 1),
    ("LS", "special_teams", 1),
]

ATTRS = [
    "spd", "acc", "agi", "cod", "str", "sta", "tgh", "inj", "awr", "prc", "jmp",
    "trk", "sfa", "spm", "jkm", "car", "bcv", "cth", "spc", "cit", "rls",
    "srr", "mrr", "drr", "thp", "tas", "tam", "tad", "tor", "pac",
    "rbk", "pbk", "ibk", "mcv", "zcv", "prs", "pur", "tak", "pow", "kpw", "kac", "ret",
]

PROFILE = {
    "QB": dict(key=["thp", "tas", "tam", "tad", "tor", "pac", "awr", "prc"], arch=["gunslinger", "field general", "scrambler"]),
    "RB": dict(key=["spd", "acc", "agi", "cod", "car", "bcv", "jkm", "spm", "trk", "sfa"], arch=["power back", "elusive", "receiving back"]),
    "WR": dict(key=["spd", "acc", "agi", "cth", "spc", "cit", "rls", "srr", "mrr", "drr", "jmp"], arch=["deep threat", "possession", "slot"]),
    "TE": dict(key=["cth", "cit", "rbk", "str", "srr", "mrr", "jmp", "tgh"], arch=["vertical threat", "blocking", "hybrid"]),
    "OL": dict(key=["rbk", "pbk", "ibk", "str", "awr", "tgh", "sta"], arch=["pass protector", "road grader", "agile"]),
    "DL": dict(key=["str", "pow", "tak", "pur", "acc", "prc", "tgh"], arch=["speed rusher", "run stuffer", "power rusher"]),
    "LB": dict(key=["tak", "pow", "pur", "prc", "zcv", "spd", "acc", "str"], arch=["field general", "pass coverage", "run stopper"]),
    "DB": dict(key=["spd", "acc", "agi", "cod", "mcv", "zcv", "prs", "jmp", "pur"], arch=["man to man", "zone", "slot corner", "hard hitter"]),
    "K":  dict(key=["kpw", "kac", "awr"], arch=["accurate", "power"]),
    "P":  dict(key=["kpw", "kac", "awr"], arch=["directional", "power"]),
    "LS": dict(key=["awr", "tgh", "tak"], arch=["specialist"]),
}

# Where each position sits on ONE club-wide overall scale. Skill positions carry
# the top of the range; specialists are rated within their own much narrower band,
# the way a depth chart actually reads.
POS_SCALE = {
    "QB": (52, 99), "WR": (52, 97), "RB": (52, 96), "TE": (50, 94),
    "OL": (50, 94), "DL": (52, 97), "LB": (50, 95), "DB": (52, 96),
    "K":  (46, 82), "P": (44, 78), "LS": (40, 70),
}

JERSEY = {p: r for p, _, r in [("QB", 0, (1, 19)), ("RB", 0, (20, 49)), ("WR", 0, (10, 19)),
                                ("TE", 0, (80, 89)), ("OL", 0, (50, 79)), ("DL", 0, (90, 99)),
                                ("LB", 0, (40, 59)), ("DB", 0, (20, 39)), ("K", 0, (1, 9)),
                                ("P", 0, (1, 9)), ("LS", 0, (40, 49))]}


def norm_name(s):
    """Roster and snap files spell names differently (punctuation, suffixes)."""
    s = (s or "").lower().strip()
    for junk in (".", "'", "-", " jr", " sr", " ii", " iii", " iv"):
        s = s.replace(junk, "")
    return " ".join(s.split())


def clamp(v, lo=20, hi=99):
    return int(max(lo, min(hi, round(v))))


def num(s, dflt=0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return dflt


def rate(rng, pos, depth_idx, ht, wt, exp, usage=0.0):
    """Our ratings model. USAGE (share of the club's snaps at this position) is the
    primary signal, because it is the only real talent evidence in the data; depth
    rank is a weak fallback for players with no snaps.

    Noise is kept small ON PURPOSE. An earlier version used sigma 6.5 on the key
    attributes, which is wider than the gap between adjacent depth ranks -- so the
    jitter outranked the signal and a 36-snap third-string QB scored above a
    1207-snap franchise starter on the same club. Signal must dominate noise.
    """
    prof = PROFILE[pos]
    rank = max(0.0, 1.0 - depth_idx * 0.15)
    # Snap share is superlinear: a full-time starter is much further from a rotational
    # player than their raw snap ratio suggests.
    play = usage ** 0.65
    tier = 0.78 * play + 0.22 * rank
    veteran = min(1.0, exp / 8.0)
    base = 54 + tier * 34 + veteran * 3

    out = {}
    key = set(prof["key"])
    for a in ATTRS:
        if a in key:
            v = base + rng.gauss(5, 3.0)
        elif a in ("awr", "prc"):
            v = base * 0.80 + veteran * 9 + rng.gauss(3, 4)
        elif a in ("sta", "tgh"):
            v = base * 0.84 + rng.gauss(4, 4)
        elif a == "inj":
            v = 70 + rng.gauss(8, 9)
        else:
            v = 32 + rng.gauss(8, 10)
        out[a] = clamp(v)

    # Physics: mass buys power and costs speed; height buys reach and costs agility.
    if wt:
        heavy = max(0.0, (wt - 250) / 100.0)
        out["spd"] = clamp(out["spd"] - heavy * 26)
        out["acc"] = clamp(out["acc"] - heavy * 20)
        out["agi"] = clamp(out["agi"] - heavy * 22)
        out["str"] = clamp(out["str"] + heavy * 20)
        out["pow"] = clamp(out["pow"] + heavy * 12)
    if ht:
        tall = (ht - 72) / 10.0
        out["jmp"] = clamp(out["jmp"] + tall * 6)
        out["cod"] = clamp(out["cod"] - tall * 6)

    # Raw is the mean of the position's own key attributes -- fine WITHIN a position,
    # meaningless across them. POS_SCALE maps each position onto one club-wide scale
    # so the depth chart sorts sanely and a snapper cannot lead the team.
    raw = sum(out[a] for a in prof["key"]) / len(prof["key"])
    lo, hi = POS_SCALE[pos]
    out["ovr"] = clamp(lo + (raw - 52) / 44.0 * (hi - lo), lo, hi)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="nflverse roster_weekly_<season>.csv")
    ap.add_argument("--season", type=int, default=None, help="season to use (default: the newest present)")
    ap.add_argument("--snaps", default=None,
                    help="nflverse snap_counts_<season>.csv -- the ONLY reliable depth signal")
    a = ap.parse_args()

    # Depth order comes from SNAPS PLAYED, not from the roster file. A weekly roster
    # marks backups ACT every week exactly like starters, so it carries no usage
    # signal at all -- ranking on it put a backup QB ahead of his own starter.
    snaps = defaultdict(float)
    if a.snaps:
        for r in csv.DictReader(open(a.snaps, newline="", encoding="utf-8", errors="replace")):
            k = norm_name(r.get("player", ""))
            if not k:
                continue
            snaps[k] += num(r.get("offense_snaps")) + num(r.get("defense_snaps")) + num(r.get("st_snaps")) * 0.25

    rows = list(csv.DictReader(open(a.csv, newline="", encoding="utf-8", errors="replace")))
    seasons = {int(r["season"]) for r in rows if r.get("season", "").isdigit()}
    season = a.season or max(seasons)

    # One record per player: the LATEST week they appear, so late-season roster
    # moves win and a player traded mid-season lands on the club he ended on.
    latest, weeks_active = {}, defaultdict(int)
    for r in rows:
        if not r.get("season", "").isdigit() or int(r["season"]) != season:
            continue
        if r.get("position") not in PROFILE:
            continue
        name = (r.get("full_name") or "").strip()
        if not name:
            continue
        # Weeks ACTIVE is the honest starter proxy. "Which week did I last see him"
        # is noise -- it ranked a week-18 backup above a season-long starter.
        if (r.get("status") or "").upper() == "ACT":
            weeks_active[name] += 1
        wk = int(r["week"]) if r.get("week", "").isdigit() else 0
        prev = latest.get(name)
        if prev is None or wk > prev[0]:
            latest[name] = (wk, r)

    by_pos = defaultdict(list)
    for wk, r in latest.values():
        team = TEAM_FIX.get(r["team"], r["team"])
        by_pos[(team, r["position"])].append(r)

    rng = random.Random(SEED)
    by_team, depth = {}, {}
    teams = sorted({TEAM_FIX.get(r["team"], r["team"]) for _, r in latest.values()})

    for team in teams:
        roster, groups, used = [], defaultdict(list), set()
        for pos, grp, count in SHAPE:
            pool = by_pos.get((team, pos), [])
            # More weeks on the roster is the honest proxy for "starter" in a
            # weekly file: a player who was there all year outranks a call-up.
            pool.sort(key=lambda r: (-snaps.get(norm_name(r.get("full_name", "")), 0.0),
                                     -weeks_active.get(r["full_name"], 0),
                                     -num(r.get("years_exp")), r.get("full_name", "")))
            top_snaps = max((snaps.get(norm_name(x.get("full_name", "")), 0.0) for x in pool[:count]), default=0.0)
            for i, r in enumerate(pool[:count]):
                usage = (snaps.get(norm_name(r.get("full_name", "")), 0.0) / top_snaps) if top_snaps > 0 else 0.0
                ht, wt = num(r.get("height")), num(r.get("weight"))
                exp = num(r.get("years_exp"))
                jn = r.get("jersey_number", "")
                jn = int(float(jn)) if jn not in ("", None) and str(jn).replace(".", "").isdigit() else 0
                if jn == 0 or jn in used:
                    lo, hi = JERSEY[pos]
                    for _ in range(300):
                        c = rng.randint(lo, hi)
                        if c not in used:
                            jn = c
                            break
                used.add(jn)

                p = {
                    "name": r["full_name"], "team": team, "pos": pos, "grp": grp,
                    "num": jn, "ht": int(ht), "wt": int(wt),
                    "age": 0, "exp": int(exp),
                    "col": (r.get("college") or "").strip(),
                    "arch": rng.choice(PROFILE[pos]["arch"]),
                    "run": rng.choice(["upright", "loose", "compact", "powerful"]),
                    "dpos": (r.get("depth_chart_position") or pos).strip(),
                }
                p.update(rate(rng, pos, i, ht, wt, exp, usage))
                p["snaps"] = int(snaps.get(norm_name(r.get("full_name", "")), 0))
                roster.append(p)
                groups[grp].append(p)

        roster.sort(key=lambda p: -p["ovr"])
        by_team[team] = roster
        depth[team] = {g: [p["name"] for p in sorted(ps, key=lambda p: -p["ovr"])]
                       for g, ps in sorted(groups.items())}

    meta = {
        "league": "NFL",
        "season": season,
        "generated": "tools/build-rosters.py",
        "seed": SEED,
        "rosterSource": "nflverse-data weekly rosters (public): name, club, position, jersey, height, weight, experience, college",
        "ratingsSource": "GENERATED by tools/build-rosters.py from position, physicals, experience and snaps played. No published ratings product is used.",
        "depthSource": "snap counts (offense + defense + 0.25 * special teams), season totals",
        "attrKeys": ATTRS,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "players.json").write_text(json.dumps({"meta": meta, "byTeam": by_team}))
    (OUT / "depth.json").write_text(json.dumps(depth, indent=1))

    tot = sum(len(r) for r in by_team.values())
    print(f"[rosters] season {season}: {len(by_team)} clubs, {tot} players -> src/data/")


if __name__ == "__main__":
    main()
