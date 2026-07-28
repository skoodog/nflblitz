#!/usr/bin/env python3
"""Generate the BLITZ RELOADED league: 32 original clubs and their rosters.

This replaces an earlier data layer that had been built from real NFL club
identities and a scraped third-party Madden ratings dump. Everything here is
invented: club nicknames, colors, player names and every attribute rating are
generated from a fixed seed. Real city names are used the same way the concept
art uses them -- New York Strykers, Chicago Maulers -- because a city name is
not a club identity.

Schema is byte-compatible with what the pieces already consume:
  src/data/teams.json    {meta, teams:   {ABBR: {abbr, city, nick, name, conf, div, colors[]}}}
  src/data/players.json  {meta, byTeam:  {ABBR: [{name, pos, grp, num, ovr, ...attrs}]}}
  src/data/depth.json    {ABBR: {group: [name, ...]}}

    python3 tools/build-league-data.py
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"
SEED = 20260728

# ---------------------------------------------------------------- clubs ----
# conf/div, city, nick, abbr, colors [primary, secondary, accent, neutral].
# The first four are the clubs that appear in the concept art and their palettes
# are read straight off those panels.
CLUBS = [
    # IRON CONFERENCE
    ("IRON", "East",  "New York",     "Strykers",  "NYC", ["#2FA8A0", "#0B1418", "#D8E4E2", "#7C8B8E"]),
    ("IRON", "East",  "Philadelphia", "Ironsides", "PHI", ["#1F4B3F", "#C8B273", "#0D1512", "#8A9691"]),
    ("IRON", "East",  "Boston",       "Wardens",   "BOS", ["#1B2A4A", "#C0392B", "#E6E9EF", "#79839A"]),
    ("IRON", "East",  "Baltimore",    "Ravagers",  "BAL", ["#3B1E5A", "#E0B531", "#120A1C", "#8177A0"]),
    ("IRON", "North", "Chicago",      "Maulers",   "CHI", ["#B3121F", "#141414", "#D9D2C4", "#7E7A72"]),
    ("IRON", "North", "Detroit",      "Foundry",   "DET", ["#D95A1E", "#2B2B30", "#EDE6DA", "#84807E"]),
    ("IRON", "North", "Cleveland",    "Riveters",  "CLE", ["#7A4A20", "#F2A03D", "#1A1410", "#94867A"]),
    ("IRON", "North", "Minneapolis",  "Frostbite", "MIN", ["#3E7FC1", "#DDEBF7", "#101A24", "#7B8C9E"]),
    ("IRON", "South", "Miami",        "Barracuda", "MIA", ["#12B5C4", "#F25C54", "#06282C", "#7FA6AA"]),
    ("IRON", "South", "Atlanta",      "Nightjars", "ATL", ["#1A1A1F", "#C81E44", "#D6D2CC", "#7A767E"]),
    ("IRON", "South", "Nashville",    "Ramblers",  "NSH", ["#245C7A", "#E8C547", "#0C1A22", "#7D8B92"]),
    ("IRON", "South", "Houston",      "Derrick",   "HOU", ["#0F2A38", "#F07818", "#DCE2E6", "#76858C"]),
    ("IRON", "West",  "Los Angeles",  "Titans",    "LA",  ["#12141A", "#E8B923", "#5A4B18", "#8A8574"]),
    ("IRON", "West",  "Seattle",      "Tidewatch", "SEA", ["#1D6B5E", "#8ED6C0", "#08181A", "#77938D"]),
    ("IRON", "West",  "Phoenix",      "Scorch",    "PHX", ["#C0341E", "#F2B33D", "#1B0F0A", "#96827A"]),
    ("IRON", "West",  "Las Vegas",    "Aces",      "LV",  ["#0C0C0F", "#C9CED6", "#8E1B2E", "#6F737A"]),
    # STORM CONFERENCE
    ("STORM", "East", "Washington",   "Sentinels", "WAS", ["#5A1B2E", "#D4A24C", "#160A10", "#8C7C74"]),
    ("STORM", "East", "Pittsburgh",   "Blastmen",  "PIT", ["#1A1A1A", "#F2C744", "#D9D9D9", "#7A776C"]),
    ("STORM", "East", "Buffalo",      "Whiteout",  "BUF", ["#204A8C", "#E9EEF5", "#0B1424", "#78859C"]),
    ("STORM", "East", "Newark",       "Dockhands", "NWK", ["#2E4A3A", "#D96A2B", "#0E1712", "#7F8A80"]),
    ("STORM", "North", "Green Bay",   "Timberjaw", "GB",  ["#2A4A22", "#D8C48A", "#0C140A", "#7F8874"]),
    ("STORM", "North", "Milwaukee",   "Steamworks","MIL", ["#3A4A5A", "#E07B39", "#101418", "#7C848C"]),
    ("STORM", "North", "Indianapolis","Velocity",  "IND", ["#1B4A8C", "#7FD1F0", "#08121F", "#76879C"]),
    ("STORM", "North", "Cincinnati",  "Prowlers",  "CIN", ["#E06A1B", "#141414", "#D8D0C6", "#82796F"]),
    ("STORM", "South", "New Orleans", "Voodoo",    "NO",  ["#4A2A6B", "#C9A227", "#120C1A", "#847A8C"]),
    ("STORM", "South", "Tampa",       "Cyclone",   "TB",  ["#8C1B2E", "#C0C6CC", "#0F0A0C", "#7E7276"]),
    ("STORM", "South", "Charlotte",   "Kingsnakes","CLT", ["#1B6B8C", "#0A1A22", "#C9D8DE", "#748A94"]),
    ("STORM", "South", "Dallas",      "Outlaws",   "DAL", ["#0E1A12", "#3FBF5A", "#C8D2CA", "#74857A"]),
    ("STORM", "West",  "Denver",      "Altitude",  "DEN", ["#2A3A6B", "#E8912B", "#0A0F1C", "#78809C"]),
    ("STORM", "West",  "San Francisco","Quakes",   "SF",  ["#8C2A1B", "#E0C9A0", "#140A08", "#8C8074"]),
    ("STORM", "West",  "Portland",    "Ironwood",  "POR", ["#2E4A32", "#B5763A", "#0C120D", "#7A8478"]),
    ("STORM", "West",  "Kansas City", "Stampede",  "KC",  ["#7A1B2A", "#E0B04A", "#120A0C", "#88787A"]),
]

# --------------------------------------------------------------- names -----
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

# ---------------------------------------------------------- roster shape ----
# (pos, group, count, jersey range)
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

# Per position: the attributes that define it (rated high), and physical ranges.
# Everything unnamed lands near a low baseline, the way a real rating set behaves.
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
    # Depth position drives the talent curve: starters are good, backups are not.
    tier = max(0.0, 1.0 - depth_idx * 0.16) + rng.gauss(0, 0.12)
    base = 58 + tier * 30

    while True:
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        if name not in used_names:
            used_names.add(name)
            break

    lo, hi = prof["ht"]
    ht = rng.randint(lo, hi)
    wlo, whi = prof["wt"]
    wt = rng.randint(wlo, whi)

    p = {
        "name": name, "team": team, "pos": pos, "grp": grp,
        "num": 0, "ht": ht, "wt": wt,
        "age": rng.randint(21, 35),
        "exp": 0, "col": "", "arch": rng.choice(prof["arch"]),
        "run": rng.choice(["upright", "loose", "compact", "powerful"]),
        "ovr": 0,
    }

    jlo, jhi = None, None
    for spec in ROSTER:
        if spec[0] == pos:
            jlo, jhi = spec[3]
    for _ in range(400):
        n = rng.randint(jlo, jhi)
        if n not in used_nums:
            used_nums.add(n)
            p["num"] = n
            break
    else:
        p["num"] = rng.randint(1, 99)

    p["exp"] = max(0, p["age"] - 22 + rng.randint(-1, 1))

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

    # Overall is a weighted read of the position's defining attributes, so the
    # number a card shows agrees with the bars underneath it.
    p["ovr"] = clamp(sum(p[a] for a in prof["key"]) / len(prof["key"]) + rng.gauss(0, 2))

    # Big men are not fast; keep the physics plausible.
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
        "league": "BLITZ RELOADED",
        "generated": "tools/build-league-data.py",
        "seed": SEED,
        "note": (
            "Wholly fictional league. Club nicknames, colors, player names and every "
            "attribute rating are generated from the seed above. City names are used "
            "the way the concept art uses them and carry no club identity. No real "
            "league, club, player or third-party ratings data is included."
        ),
        "conferences": ["IRON", "STORM"],
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
