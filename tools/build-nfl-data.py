#!/usr/bin/env python3
"""Build the real-NFL data layer: 32 teams + rated players with Madden attributes.

Sources (both fetched from GitHub, the only host this container's network policy allows):
  teams   -- nflverse/nflverse-data  teams_colors_logos.csv  (real names, conf/div, official colors)
  players -- theedgepredictor/nfl-madden-data  data/madden/processed/2025.csv
             (Madden 26 / season-2025 ratings, itself scraped from maddenratings.weebly.com and
             joined against nflverse player metadata)

Writes src/data/teams.json and src/data/players.json.

    python3 tools/build-nfl-data.py --teams <teams.csv> --madden <2025.csv>
"""
import argparse, csv, json, re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data"

# The attributes an arcade football game actually reads. Everything else in the
# source (combine numbers, draft metadata, pfr ids) is dropped.
ATTRS = [
    "overallrating", "speed", "acceleration", "agility", "changeofdirection", "strength",
    "stamina", "toughness", "injury", "awareness", "playrecognition", "jumping",
    "trucking", "stiffarm", "spinmove", "jukemove", "carrying", "ballcarriervision",
    "catching", "spectacularcatch", "catchintraffic", "release",
    "shortrouterunning", "midrouterunning", "deeprouterunning",
    "throwpower", "throwaccuracyshort", "throwaccuracymid", "throwaccuracydeep",
    "throwonrun", "playaction",
    "runblocking", "passblocking", "impactblocking",
    "mancoverage", "zonecoverage", "press", "pursuit", "tackle", "hitpower",
    "kickpower", "kickaccuracy", "return",
]

# Short keys keep the runtime payload small; the game reads these.
SHORT = {
    "overallrating": "ovr", "speed": "spd", "acceleration": "acc", "agility": "agi",
    "changeofdirection": "cod", "strength": "str", "stamina": "sta", "toughness": "tgh",
    "injury": "inj", "awareness": "awr", "playrecognition": "prc", "jumping": "jmp",
    "trucking": "trk", "stiffarm": "sfa", "spinmove": "spm", "jukemove": "jkm",
    "carrying": "car", "ballcarriervision": "bcv", "catching": "cth",
    "spectacularcatch": "spc", "catchintraffic": "cit", "release": "rls",
    "shortrouterunning": "srr", "midrouterunning": "mrr", "deeprouterunning": "drr",
    "throwpower": "thp", "throwaccuracyshort": "tas", "throwaccuracymid": "tam",
    "throwaccuracydeep": "tad", "throwonrun": "tor", "playaction": "pac",
    "runblocking": "rbk", "passblocking": "pbk", "impactblocking": "ibk",
    "mancoverage": "mcv", "zonecoverage": "zcv", "press": "prs", "pursuit": "pur",
    "tackle": "tak", "hitpower": "pow", "kickpower": "kpw", "kickaccuracy": "kac",
    "return": "ret",
}

# A 7-on-7 arcade game fields these. Source positions are already grouped
# (QB/RB/WR/TE/OL/DL/LB/CB/S/K/P) in the processed dataset.
OFFENSE = {"QB", "RB", "FB", "WR", "TE", "OL"}
DEFENSE = {"DL", "LB", "CB", "S"}


def i(v, default=0):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return default


def parse_height(v):
    """Source height is inches (or feet-inches like 6-4 in some rows)."""
    if not v:
        return 0
    v = str(v).strip()
    m = re.match(r"^(\d+)[-'](\d+)", v)
    if m:
        return int(m.group(1)) * 12 + int(m.group(2))
    return i(v)


def build_teams(path):
    teams = {}
    for r in csv.DictReader(open(path)):
        abbr = r["team_abbr"].strip()
        conf, div = r.get("team_conf", "").strip(), r.get("team_division", "").strip()
        if not conf or not div:
            continue
        full = r["team_name"].strip()
        nick = r["team_nick"].strip()
        city = full[: -len(nick)].strip() if full.endswith(nick) else full
        teams[abbr] = {
            "abbr": abbr, "city": city, "nick": nick, "name": full,
            "conf": conf, "div": div.replace(conf + " ", ""),
            "colors": [c for c in (
                r.get("team_color"), r.get("team_color2"),
                r.get("team_color3"), r.get("team_color4"),
            ) if c and c.startswith("#")],
        }
    # nflverse carries legacy abbreviations (OAK/SD/OTI/...). Keep the 32 current clubs.
    current = {t for t in teams if t not in {"OAK", "SD", "STL", "LAR2", "SL"}}
    teams = {k: v for k, v in teams.items() if k in current}
    if len(teams) != 32:
        # de-dupe by full name, preferring the abbreviation used by the ratings source
        seen, keep = {}, {}
        for k, v in teams.items():
            if v["name"] not in seen:
                seen[v["name"]] = k
                keep[k] = v
        teams = keep
    return dict(sorted(teams.items()))


def build_players(path, teams):
    by_team = defaultdict(list)
    skipped = 0
    for r in csv.DictReader(open(path)):
        team = (r.get("team") or "").strip()
        ovr = r.get("overallrating")
        if team not in teams or not ovr:
            skipped += 1
            continue
        p = {
            "name": (r.get("fullname") or "").strip(),
            "team": team,
            "pos": (r.get("position") or "").strip(),
            "grp": (r.get("position_group") or "").strip(),
            "num": i(r.get("jerseynumber")),
            "ht": parse_height(r.get("height")),
            "wt": i(r.get("weight")),
            "age": i(r.get("age")),
            "exp": i(r.get("yearspro")),
            "col": (r.get("college_name") or "").strip(),
            "arch": (r.get("archetype") or "").strip(),
            "run": (r.get("runningstyle") or "").strip(),
        }
        for a in ATTRS:
            p[SHORT[a]] = i(r.get(a))
        by_team[team].append(p)

    for t in by_team:
        by_team[t].sort(key=lambda p: (-p["ovr"], p["name"]))
    return dict(sorted(by_team.items())), skipped


def depth_chart(players):
    """Best-N per position group -- what the 7-on-7 sim actually fields."""
    out = {}
    for team, roster in players.items():
        groups = defaultdict(list)
        for p in roster:
            groups[p["grp"] or p["pos"]].append(p["name"])
        out[team] = {g: names[:6] for g, names in sorted(groups.items())}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--teams", required=True)
    ap.add_argument("--madden", required=True)
    a = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    teams = build_teams(a.teams)
    players, skipped = build_players(a.madden, teams)

    meta = {
        "source": {
            "teams": "nflverse/nflverse-data teams_colors_logos.csv",
            "ratings": "theedgepredictor/nfl-madden-data data/madden/processed/2025.csv "
                       "(Madden 26 / season 2025, scraped from maddenratings.weebly.com)",
        },
        "attrKeys": SHORT,
        "teamCount": len(teams),
        "playerCount": sum(len(v) for v in players.values()),
    }

    (OUT / "teams.json").write_text(json.dumps({"meta": meta, "teams": teams}, indent=1))
    (OUT / "players.json").write_text(json.dumps({"meta": meta, "byTeam": players}, separators=(",", ":")))
    (OUT / "depth.json").write_text(json.dumps(depth_chart(players), indent=1))

    print(f"teams.json   {len(teams)} teams")
    print(f"players.json {meta['playerCount']} rated players ({skipped} rows skipped: unrated/FA)")
    for f in ("teams.json", "players.json", "depth.json"):
        print(f"  {f:<14} {(OUT / f).stat().st_size // 1024} KB")
