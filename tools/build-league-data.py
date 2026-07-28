#!/usr/bin/env python3
"""Build the league data layer: the 32 NFL clubs, with generated rosters.

Club identity here is REAL -- names, abbreviations, conferences, divisions and
official colours -- because the marks the game renders are the real club marks
the user supplied. Player data is NOT real: names and every attribute rating are
generated from the fixed seed below. (An earlier version of this file pulled 2003
real players with Madden ratings scraped from a third-party site; that is not
restored, and nobody has asked for it.)

Crest artwork is resolved separately, at bar/logos/<ABBR>.png -- see
src/pieces/brand-identity/crestsource.js. Clubs with no logo file fall back to
the procedural crest generator, so the game runs with or without the artwork.

Schema is unchanged, so every consumer keeps working:
  src/data/teams.json    {meta, teams:  {ABBR: {abbr, city, nick, name, conf, div, colors[]}}}
  src/data/players.json  {meta, byTeam: {ABBR: [{name, pos, grp, num, ovr, ...attrs}]}}
  src/data/depth.json    {ABBR: {group: [name, ...]}}

    python3 tools/build-league-data.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"
SEED = 20260728

# conf, div, city, nick, abbr, official colours [primary, secondary, accent, neutral].
# Order matches the supplied logo sheet, read left-to-right, top-to-bottom.
CLUBS = [
    ("NFC", "East",  "Dallas",        "Cowboys",    "DAL", ["#003594", "#869397", "#FFFFFF", "#7F9695"]),
    ("NFC", "East",  "New York",      "Giants",     "NYG", ["#0B2265", "#A71930", "#A5ACAF", "#7A8288"]),
    ("NFC", "East",  "Philadelphia",  "Eagles",     "PHI", ["#004C54", "#A5ACAF", "#ACC0C6", "#748A8D"]),
    ("NFC", "East",  "Washington",    "Commanders", "WAS", ["#5A1414", "#FFB612", "#FFFFFF", "#8C7A5E"]),
    ("NFC", "North", "Chicago",       "Bears",      "CHI", ["#0B162A", "#C83803", "#FFFFFF", "#6E6A66"]),
    ("NFC", "North", "Detroit",       "Lions",      "DET", ["#0076B6", "#B0B7BC", "#000000", "#7C878E"]),
    ("NFC", "North", "Green Bay",     "Packers",    "GB",  ["#203731", "#FFB612", "#FFFFFF", "#7A7F60"]),
    ("NFC", "North", "Minnesota",     "Vikings",    "MIN", ["#4F2683", "#FFC62F", "#FFFFFF", "#7E6E96"]),
    ("NFC", "South", "Atlanta",       "Falcons",    "ATL", ["#A71930", "#000000", "#A5ACAF", "#8A7276"]),
    ("NFC", "South", "Carolina",      "Panthers",   "CAR", ["#0085CA", "#101820", "#BFC0BF", "#6E7E88"]),
    ("NFC", "South", "New Orleans",   "Saints",     "NO",  ["#D3BC8D", "#101820", "#FFFFFF", "#8A8172"]),
    ("NFC", "South", "Tampa Bay",     "Buccaneers", "TB",  ["#D50A0A", "#34302B", "#FF7900", "#8A6A62"]),
    ("NFC", "West",  "Arizona",       "Cardinals",  "ARI", ["#97233F", "#000000", "#FFB612", "#8A6A72"]),
    ("NFC", "West",  "Los Angeles",   "Rams",       "LAR", ["#003594", "#FFA300", "#FFFFFF", "#7A8296"]),
    ("NFC", "West",  "San Francisco", "49ers",      "SF",  ["#AA0000", "#B3995D", "#FFFFFF", "#8A7A6A"]),
    ("NFC", "West",  "Seattle",       "Seahawks",   "SEA", ["#002244", "#69BE28", "#A5ACAF", "#6E8A80"]),
    ("AFC", "East",  "Buffalo",       "Bills",      "BUF", ["#00338D", "#C60C30", "#FFFFFF", "#7A8296"]),
    ("AFC", "East",  "Miami",         "Dolphins",   "MIA", ["#008E97", "#FC4C02", "#005778", "#6E9296"]),
    ("AFC", "East",  "New England",   "Patriots",   "NE",  ["#002244", "#C60C30", "#B0B7BC", "#7A8290"]),
    ("AFC", "East",  "New York",      "Jets",       "NYJ", ["#125740", "#000000", "#FFFFFF", "#6E8278"]),
    ("AFC", "North", "Baltimore",     "Ravens",     "BAL", ["#241773", "#000000", "#9E7C0C", "#7A7290"]),
    ("AFC", "North", "Cincinnati",    "Bengals",    "CIN", ["#FB4F14", "#000000", "#FFFFFF", "#8A7A6E"]),
    ("AFC", "North", "Cleveland",     "Browns",     "CLE", ["#311D00", "#FF3C00", "#FFFFFF", "#7A6A5A"]),
    ("AFC", "North", "Pittsburgh",    "Steelers",   "PIT", ["#FFB612", "#101820", "#C60C30", "#8A8272"]),
    ("AFC", "South", "Houston",       "Texans",     "HOU", ["#03202F", "#A71930", "#FFFFFF", "#6E7A82"]),
    ("AFC", "South", "Indianapolis",  "Colts",      "IND", ["#002C5F", "#A2AAAD", "#FFFFFF", "#7A8690"]),
    ("AFC", "South", "Jacksonville",  "Jaguars",    "JAX", ["#101820", "#D7A22A", "#006778", "#7A7A6E"]),
    ("AFC", "South", "Tennessee",     "Titans",     "TEN", ["#0C2340", "#4B92DB", "#C8102E", "#6E7E90"]),
    ("AFC", "West",  "Denver",        "Broncos",    "DEN", ["#FB4F14", "#002244", "#FFFFFF", "#8A7A72"]),
    ("AFC", "West",  "Kansas City",   "Chiefs",     "KC",  ["#E31837", "#FFB81C", "#FFFFFF", "#8A7266"]),
    ("AFC", "West",  "Las Vegas",     "Raiders",    "LV",  ["#000000", "#A5ACAF", "#FFFFFF", "#7A7E80"]),
    ("AFC", "West",  "Los Angeles",   "Chargers",   "LAC", ["#0080C6", "#FFC20E", "#FFFFFF", "#7A8A90"]),
]

FIRST = [
    "Marcus", "Dante", "Elijah", "Kaden", "Jamal", "Tyrese", "Cole", "Roman", "Zane", "Isaiah",
    "Darius", "Malik", "Rhett", "Xavier", "Amari", "Brock", "Kellan", "Deshawn", "Nico", "Silas",
    "Trey", "Quinton", "Jaxon", "Oren", "Bishop", "Camden", "Lorenzo", "Kwame", "Cass", "Ronan",
    "Terrell", "Dominic", "Reef", "Cyrus", "Jarrell", "Miles", "Aden", "Vance", "Kobe", "Rashad",
    "Solomon", "Kyrie", "Emeka", "Bo", "Jericho", "Thane", "Devonte", "Luca", "Ozzie", "Marlon",
]
LAST = [
    "Boone", "Vance", "Ryder", "Colter", "Mackey", "Deloach", "Ashworth", "Rennick", "Salter", "Kade",
    "Brannigan", "Okafor", "Sable", "Whitlock", "Ferris", "Rowe", "Tackett", "Yarborough", "Vega", "Stroud",
    "Merrick", "Halloran", "Bexley", "Crowder", "Nkemdi", "Rask", "Loudermilk", "Pryor", "Cassidy", "Ozuna",
    "Hargrove", "Steed", "Vaughters", "Ibarra", "Kilgore", "Mensah", "Draper", "Solano", "Redfern", "Cobb",
    "Sirianni", "Aguon", "Threadgill", "Bexar", "Ocampo", "Fairbanks", "Lund", "Trask", "Devereaux", "Ansah",
    "Quillen", "Marchetti", "Dembele", "Rockwell", "Sandoval", "Ashby", "Traore", "Voss", "Hennig", "Palacios",
]

ROSTER = [
    ("QB", "quarterback",   3, (1, 19)),
    ("RB", "o_rush",        5, (20, 49)),
    ("WR", "o_pass",        9, (10, 19)),
    ("TE", "o_te",          4, (80, 89)),
    ("OL", "o_line",       10, (50, 79)),
    ("DL", "d_line",        9, (90, 99)),
    ("LB", "d_lb",          8, (40, 59)),
    ("DB", "d_field",      10, (20, 39)),
    ("K",  "special_teams", 1, (1, 9)),
    ("P",  "special_teams", 1, (1, 9)),
    ("LS", "special_teams", 1, (40, 49)),
]

ATTRS = [
    "spd", "acc", "agi", "cod", "str", "sta", "tgh", "inj", "awr", "prc", "jmp",
    "trk", "sfa", "spm", "jkm", "car", "bcv", "cth", "spc", "cit", "rls",
    "srr", "mrr", "drr", "thp", "tas", "tam", "tad", "tor", "pac",
    "rbk", "pbk", "ibk", "mcv", "zcv", "prs", "pur", "tak", "pow", "kpw", "kac", "ret",
]

PROFILE = {
    "QB": dict(key=["thp", "tas", "tam", "tad", "tor", "pac", "awr", "prc"],
               ht=(74, 79), wt=(205, 245), arch=["gunslinger", "field general", "scrambler"]),
    "RB": dict(key=["spd", "acc", "agi", "cod", "car", "bcv", "jkm", "spm", "trk", "sfa"],
               ht=(68, 74), wt=(195, 245), arch=["power back", "elusive", "receiving back"]),
    "WR": dict(key=["spd", "acc", "agi", "cth", "spc", "cit", "rls", "srr", "mrr", "drr", "jmp"],
               ht=(69, 78), wt=(175, 225), arch=["deep threat", "possession", "slot"]),
    "TE": dict(key=["cth", "cit", "rbk", "str", "srr", "mrr", "jmp", "tgh"],
               ht=(75, 80), wt=(240, 275), arch=["vertical threat", "blocking", "hybrid"]),
    "OL": dict(key=["rbk", "pbk", "ibk", "str", "awr", "tgh", "sta"],
               ht=(76, 82), wt=(300, 345), arch=["pass protector", "road grader", "agile"]),
    "DL": dict(key=["str", "pow", "tak", "pur", "acc", "prc", "tgh"],
               ht=(74, 80), wt=(280, 330), arch=["speed rusher", "run stuffer", "power rusher"]),
    "LB": dict(key=["tak", "pow", "pur", "prc", "zcv", "spd", "acc", "str"],
               ht=(72, 77), wt=(230, 260), arch=["field general", "pass coverage", "run stopper"]),
    "DB": dict(key=["spd", "acc", "agi", "cod", "mcv", "zcv", "prs", "jmp", "pur"],
               ht=(69, 75), wt=(180, 215), arch=["man to man", "zone", "slot corner", "hard hitter"]),
    "K":  dict(key=["kpw", "kac", "awr"], ht=(70, 75), wt=(180, 210), arch=["accurate", "power"]),
    "P":  dict(key=["kpw", "kac", "awr"], ht=(71, 76), wt=(190, 220), arch=["directional", "power"]),
    "LS": dict(key=["awr", "tgh", "tak"], ht=(73, 77), wt=(235, 260), arch=["specialist"]),
}


def clamp(v, lo=20, hi=99):
    return int(max(lo, min(hi, round(v))))


def make_player(rng, team, pos, grp, depth_idx, used_nums, used_names):
    prof = PROFILE[pos]
    tier = max(0.0, 1.0 - depth_idx * 0.16) + rng.gauss(0, 0.12)
    base = 58 + tier * 30

    while True:
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        if name not in used_names:
            used_names.add(name)
            break

    lo, hi = prof["ht"]
    wlo, whi = prof["wt"]
    ht, wt = rng.randint(lo, hi), rng.randint(wlo, whi)

    p = {
        "name": name, "team": team, "pos": pos, "grp": grp, "num": 0,
        "ht": ht, "wt": wt, "age": rng.randint(21, 35), "exp": 0, "col": "",
        "arch": rng.choice(prof["arch"]),
        "run": rng.choice(["upright", "loose", "compact", "powerful"]),
        "ovr": 0,
    }
    p["exp"] = max(0, p["age"] - 22 + rng.randint(-1, 1))

    jlo, jhi = next((s[3] for s in ROSTER if s[0] == pos), (1, 99))
    for _ in range(400):
        n = rng.randint(jlo, jhi)
        if n not in used_nums:
            used_nums.add(n)
            p["num"] = n
            break
    else:
        p["num"] = rng.randint(1, 99)

    key = set(prof["key"])
    for a in ATTRS:
        if a in key:
            v = base + rng.gauss(6, 7)
        elif a in ("sta", "tgh", "awr", "prc"):
            v = base * 0.82 + rng.gauss(4, 8)
        elif a == "inj":
            v = 70 + rng.gauss(8, 10)
        else:
            v = 32 + rng.gauss(8, 11)
        p[a] = clamp(v)

    p["ovr"] = clamp(sum(p[a] for a in prof["key"]) / len(prof["key"]) + rng.gauss(0, 2))

    if wt > 290:
        p["spd"] = clamp(min(p["spd"], 72 - (wt - 290) * 0.08))
        p["acc"] = clamp(min(p["acc"], 78 - (wt - 290) * 0.07))
    return p


def main():
    rng = random.Random(SEED)
    teams, by_team, depth = {}, {}, {}

    for conf, div, city, nick, abbr, colors in CLUBS:
        teams[abbr] = {
            "abbr": abbr, "city": city, "nick": nick, "name": f"{city} {nick}",
            "conf": conf, "div": div, "colors": colors,
            "logo": f"bar/logos/{abbr}.png",
        }
        roster, groups, nums, names = [], {}, set(), set()
        for pos, grp, count, _ in ROSTER:
            for i in range(count):
                p = make_player(rng, abbr, pos, grp, i, nums, names)
                roster.append(p)
                groups.setdefault(grp, []).append(p)
        roster.sort(key=lambda p: -p["ovr"])
        by_team[abbr] = roster
        depth[abbr] = {
            g: [p["name"] for p in sorted(ps, key=lambda p: -p["ovr"])]
            for g, ps in sorted(groups.items())
        }

    meta = {
        "league": "NFL",
        "generated": "tools/build-league-data.py",
        "seed": SEED,
        "note": (
            "Club identity (name, abbreviation, conference, division, official colours) is real, "
            "to match the real club marks the game renders from bar/logos/. Player names and every "
            "attribute rating are GENERATED from the seed above -- no real player data and no "
            "third-party ratings data is included."
        ),
        "conferences": ["AFC", "NFC"],
        "divisions": ["East", "North", "South", "West"],
        "attrKeys": ATTRS,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "teams.json").write_text(json.dumps({"meta": meta, "teams": teams}, indent=1))
    (OUT / "players.json").write_text(json.dumps({"meta": meta, "byTeam": by_team}))
    (OUT / "depth.json").write_text(json.dumps(depth, indent=1))

    tot = sum(len(r) for r in by_team.values())
    print(f"[league] {len(teams)} clubs, {tot} players -> src/data/*.json")


if __name__ == "__main__":
    main()
