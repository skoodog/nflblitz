#!/usr/bin/env python3
"""Build the shared playbook -- ONE playbook, used by all 32 clubs.

That is a deliberate rule carried over from the arcade football tradition this game
follows, and the user restated it: every club calls from the same sheet. Clubs differ
by their players' ratings, never by their plays. So this file emits exactly one
playbook and nothing keyed by club, which makes the rule structural rather than a
convention someone can quietly break later.

Geometry is in FIELD UNITS: x is across the field (-24..+24 yards from centre, so a
53.3-yard width), y is downfield in yards from the line of scrimmage. Routes are
waypoint lists the sim interpolates; they are shapes, not animations, so they read the
same whatever the play clock is doing.

    python3 tools/build-playbook.py

Writes src/data/playbook.json.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "data" / "playbook.json"

# Seven on seven. Offence is a passer, three eligible receivers and three blockers;
# defence is two rushers, a rover and four defensive backs. These slot names match
# src/data/players.json exactly, so a play references a roster slot directly.
OFF_SLOTS = ["QB", "REC1", "REC2", "REC3", "OL1", "OL2", "OL3"]
DEF_SLOTS = ["RUSH1", "RUSH2", "ROVER", "DB1", "DB2", "DB3", "DB4"]

# Pre-snap alignment, in field units relative to the ball.
FORMATION = {
    "QB":   [0.0, -4.0],
    "REC1": [-14.0, 0.5],
    "REC2": [9.0, 0.5],
    "REC3": [-4.5, -1.0],
    "OL1":  [-2.4, 0.0],
    "OL2":  [0.0, 0.0],
    "OL3":  [2.4, 0.0],
}
DEF_FORMATION = {
    "RUSH1": [-2.6, 1.2],
    "RUSH2": [2.6, 1.2],
    "ROVER": [0.0, 5.0],
    "DB1":   [-14.0, 7.0],
    "DB2":   [9.0, 7.0],
    "DB3":   [-5.0, 12.0],
    "DB4":   [4.0, 14.0],
}

# ---------------------------------------------------------------- offence ----
# Each play gives a route to the three eligible receivers. Blockers are implicit:
# OL1-3 pass-protect unless the play is a run, where they lead to a named gap.
#
# depth  = how far downfield the primary read breaks
# clock  = ticks (at 60/s) until the read is expected to come open; the sim uses it to
#          pace the rush, so a deep play genuinely needs more protection than a quick one
OFFENSE = [
    # ============================ PAGE 1 ============================
    {"id": "upper_cut", "name": "UPPER CUT", "kind": "pass", "depth": 14, "clock": 84, "page": 1,
     "note": "Two in-breakers under a clear-out. Reads inside-out.",
     "routes": {"REC1": [[-14,0],[-12,8],[-2,14]], "REC2": [[9,0],[8,7],[0,12]], "REC3": [[-4.5,-1],[-6,5],[-5,9]]}},
    {"id": "whiteout", "name": "WHITEOUT", "kind": "pass", "depth": 20, "clock": 104, "page": 1,
     "note": "Everyone releases vertical, then one breaks off late.",
     "routes": {"REC1": [[-14,0],[-13,12],[-15,21]], "REC2": [[9,0],[10,12],[12,21]], "REC3": [[-4.5,-1],[-4,10],[-1,18]]}},
    {"id": "hail_mary", "name": "HAIL MARY", "kind": "pass", "depth": 42, "clock": 150, "page": 1,
     "note": "Everything deep. Throw it up and count the bodies.",
     "routes": {"REC1": [[-14,0],[-12,20],[-9,44]], "REC2": [[9,0],[8,20],[5,44]], "REC3": [[-4.5,-1],[-3,18],[-2,42]]}},
    {"id": "turmoil", "name": "TURMOIL", "kind": "pass", "depth": 11, "clock": 72, "page": 1,
     "note": "Three crossers at three depths. Somebody comes clean.",
     "routes": {"REC1": [[-14,0],[-9,5],[8,9]], "REC2": [[9,0],[4,7],[-10,12]], "REC3": [[-4.5,-1],[-1,3],[7,5]]}},
    {"id": "split", "name": "SPLIT", "kind": "pass", "depth": 16, "clock": 90, "page": 1,
     "note": "Outs to both sidelines, the slot sits in the middle.",
     "routes": {"REC1": [[-14,0],[-14,10],[-20,15]], "REC2": [[9,0],[9,10],[16,15]], "REC3": [[-4.5,-1],[-4,6],[-4,11]]}},
    {"id": "x_cross", "name": "X CROSS", "kind": "pass", "depth": 13, "clock": 80, "page": 1,
     "note": "The outside two cross deep and swap sidelines.",
     "routes": {"REC1": [[-14,0],[-6,9],[11,15]], "REC2": [[9,0],[1,9],[-13,15]], "REC3": [[-4.5,-1],[-5,4],[-6,7]]}},
    {"id": "dog_hook", "name": "DOG HOOK", "kind": "pass", "depth": 9, "clock": 62, "page": 1,
     "note": "Hooks at the sticks. Sit down in the soft spot.",
     "routes": {"REC1": [[-14,0],[-14,9],[-12,7]], "REC2": [[9,0],[9,9],[7,7]], "REC3": [[-4.5,-1],[-4,8],[-4,6]]}},
    {"id": "up_the_gut", "name": "UP THE GUT", "kind": "run", "depth": 0, "clock": 30, "page": 1, "gap": 0.0,
     "note": "Straight ahead behind the middle. No thinking required.",
     "routes": {"REC1": [[-14,0],[-11,4],[-8,7]], "REC2": [[9,0],[7,4],[5,7]], "REC3": [[-4.5,-1],[-1,1],[0,7]]}, "primary": "REC3"},
    {"id": "screen", "name": "SCREEN", "kind": "screen", "depth": 2, "clock": 60, "page": 1,
     "note": "Let the rush come, then throw behind it with blockers out front.",
     "routes": {"REC1": [[-14,0],[-16,3],[-19,6]], "REC2": [[9,0],[9,11],[9,19]], "REC3": [[-4.5,-1],[-9,-3],[-14,-1]]}, "primary": "REC3"},

    # ============================ PAGE 2 ============================
    {"id": "long_bomb", "name": "LONG BOMB", "kind": "pass", "depth": 34, "clock": 132, "page": 2,
     "note": "Two verticals outside, one post splitting the middle.",
     "routes": {"REC1": [[-14,0],[-14,16],[-14,36]], "REC2": [[9,0],[9,16],[9,36]], "REC3": [[-4.5,-1],[-4,14],[2,34]]}},
    {"id": "back_split", "name": "BACK SPLIT", "kind": "pass", "depth": 12, "clock": 76, "page": 2,
     "note": "Back releases opposite the slot. Stretches the underneath.",
     "routes": {"REC1": [[-14,0],[-12,9],[-14,13]], "REC2": [[9,0],[7,9],[9,13]], "REC3": [[-4.5,-1],[3,2],[9,5]]}},
    {"id": "subzero", "name": "SUBZERO", "kind": "pass", "depth": 22, "clock": 108, "page": 2,
     "note": "Deep corner off a hard inside stem. Freeze the safety.",
     "routes": {"REC1": [[-14,0],[-8,12],[-18,23]], "REC2": [[9,0],[3,12],[15,23]], "REC3": [[-4.5,-1],[-4,7],[-4,12]]}},
    {"id": "dawg_hook", "name": "DAWG HOOK", "kind": "pass", "depth": 15, "clock": 88, "page": 2,
     "note": "Deeper hooks than DOG HOOK, with a checkdown underneath.",
     "routes": {"REC1": [[-14,0],[-14,15],[-11,13]], "REC2": [[9,0],[9,15],[6,13]], "REC3": [[-4.5,-1],[-6,4],[-8,3]]}},
    {"id": "utb_deep", "name": "OVER THE TOP", "kind": "pass", "depth": 28, "clock": 120, "page": 2,
     "note": "Slot runs the seam behind two dig routes.",
     "routes": {"REC1": [[-14,0],[-12,13],[-1,16]], "REC2": [[9,0],[8,13],[-2,17]], "REC3": [[-4.5,-1],[-4,14],[-3,30]]}},
    {"id": "x_slant", "name": "X SLANT", "kind": "pass", "depth": 8, "clock": 50, "page": 2,
     "note": "Three slants. The answer to pressure.",
     "routes": {"REC1": [[-14,0],[-10,5],[-5,9]], "REC2": [[9,0],[5,5],[0,9]], "REC3": [[-4.5,-1],[-1,3],[4,6]]}},
    {"id": "post_wheel", "name": "POST WHEEL", "kind": "pass", "depth": 26, "clock": 116, "page": 2,
     "note": "Wheel holds the corner, post breaks in behind it.",
     "routes": {"REC1": [[-14,0],[-13,14],[-3,27]], "REC2": [[9,0],[13,6],[12,26]], "REC3": [[-4.5,-1],[-4,5],[-4,9]]}},
    {"id": "power_right", "name": "POWER RIGHT", "kind": "run", "depth": 0, "clock": 30, "page": 2, "gap": 3.0,
     "note": "Downhill behind the right gap.",
     "routes": {"REC1": [[-14,0],[-12,4],[-10,8]], "REC2": [[9,0],[8,3],[7,6]], "REC3": [[-4.5,-1],[1,0],[6,4]]}, "primary": "REC3"},
    {"id": "qb_keeper", "name": "QB KEEPER", "kind": "run", "depth": 0, "clock": 30, "page": 2, "gap": -3.0,
     "note": "The passer keeps it round the edge. Nobody blocks it for you.",
     "routes": {"REC1": [[-14,0],[-13,6],[-13,12]], "REC2": [[9,0],[9,6],[9,12]], "REC3": [[-4.5,-1],[-8,1],[-12,2]]}, "primary": "QB"},
]

DEFENSE = [
    {"id": "man_cover", "name": "MAN COVER", "rush": 2, "cover": "man", "risk": 0.25,
     "note": "Straight man across, two after the passer.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"spy","DB1":"man","DB2":"man","DB3":"man","DB4":"zone_deep"}},
    {"id": "goal_line", "name": "GOAL LINE", "rush": 4, "cover": "man", "risk": 0.50,
     "note": "Crowd the line. Nothing gets in from close.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"press","DB2":"press","DB3":"rush","DB4":"man"}},
    {"id": "blitz_2", "name": "BLITZ 2", "rush": 4, "cover": "man", "risk": 0.60,
     "note": "Four man pressure, man behind it.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"man","DB2":"man","DB3":"rush","DB4":"zone_deep"}},
    {"id": "med_zone", "name": "MED ZONE", "rush": 2, "cover": "zone", "risk": 0.20,
     "note": "Zones at the sticks. Take away the intermediate.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"zone_hook","DB1":"zone_hook","DB2":"zone_hook","DB3":"zone_flat","DB4":"zone_deep"}},
    {"id": "all_out", "name": "ALL OUT", "rush": 6, "cover": "man", "risk": 1.00,
     "note": "Everyone but one. Sack or touchdown, nothing between.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"rush","DB2":"rush","DB3":"rush","DB4":"man"}},
    {"id": "deep_zone", "name": "DEEP ZONE", "rush": 2, "cover": "zone", "risk": 0.10,
     "note": "Everything back. Concedes the short throw, concedes nothing over the top.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"zone_hook","DB1":"zone_deep","DB2":"zone_deep","DB3":"zone_deep","DB4":"zone_deep"}},
    {"id": "blitz_1", "name": "BLITZ 1", "rush": 3, "cover": "man", "risk": 0.40,
     "note": "Three man pressure with the rover coming clean.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"man","DB2":"man","DB3":"spy","DB4":"zone_deep"}},
    {"id": "near_zone", "name": "NEAR ZONE", "rush": 3, "cover": "zone", "risk": 0.35,
     "note": "Short zones and a wall at the line. Built against the run.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"zone_flat","DB2":"zone_flat","DB3":"zone_hook","DB4":"zone_deep"}},
    {"id": "zone_blitz", "name": "ZONE BLITZ", "rush": 4, "cover": "zone", "risk": 0.55,
     "note": "Pressure from the edge, zone rotating behind it.",
     "assign": {"RUSH1":"rush","RUSH2":"rush","ROVER":"rush","DB1":"zone_flat","DB2":"zone_deep","DB3":"rush","DB4":"zone_deep"}},
]

def main():
    for p in OFFENSE:
        missing = [s for s in ("REC1", "REC2", "REC3") if s not in p["routes"]]
        if missing:
            raise SystemExit(f"play {p['id']} is missing routes for {missing}")
        p.setdefault("primary", "REC1")
    for d in DEFENSE:
        missing = [s for s in DEF_SLOTS if s not in d["assign"]]
        if missing:
            raise SystemExit(f"defense {d['id']} is missing assignments for {missing}")
        counted = sum(1 for v in d["assign"].values() if v == "rush")
        if counted != d["rush"]:
            raise SystemExit(f"defense {d['id']} says rush={d['rush']} but assigns {counted}")

    # ROUTE DISTINCTNESS. The point of eighteen plays is eighteen DIFFERENT NPC behaviours,
    # so "they are different" has to be measured rather than assumed. For every pair of
    # plays, compare where the three receivers finish; if two plays send everyone to
    # nearly the same place they are the same play wearing two names.
    def endpoints(pl):
        return [tuple(pl["routes"][s][-1]) for s in ("REC1", "REC2", "REC3")]

    # Compare only WITHIN a kind. A run and a pass are never the same play whatever the
    # receivers do -- on a run the receivers are blocking and the carrier and gap are the
    # real content -- so measuring across kinds flags false pairs and hides real ones. The
    # first version of this check did exactly that: its five closest pairs were all runs
    # against hook concepts, which told us nothing.
    worst, worst_pair = 1e9, None
    for i in range(len(OFFENSE)):
        for j in range(i + 1, len(OFFENSE)):
            if OFFENSE[i]["kind"] != OFFENSE[j]["kind"]:
                continue
            a, b = endpoints(OFFENSE[i]), endpoints(OFFENSE[j])
            d = sum(((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 for (ax, ay), (bx, by) in zip(a, b)) / 3
            if d < worst:
                worst, worst_pair = d, (OFFENSE[i]["name"], OFFENSE[j]["name"])

    # Runs are separated by where the ball actually goes, not by the receivers.
    runs = [pl for pl in OFFENSE if pl["kind"] == "run"]
    for i in range(len(runs)):
        for j in range(i + 1, len(runs)):
            if runs[i].get("gap") == runs[j].get("gap") and runs[i]["primary"] == runs[j]["primary"]:
                raise SystemExit(
                    f"runs {runs[i]['name']} and {runs[j]['name']} share a gap AND a carrier -- same play")

    MIN_SEP = 3.0
    if worst < MIN_SEP:
        raise SystemExit(
            f"plays {worst_pair[0]} and {worst_pair[1]} are only {worst:.1f} yd apart on average "
            f"at the route ends -- that is the same play twice (min {MIN_SEP})")

    # Same for defence: two calls that assign every slot identically are one call.
    for i in range(len(DEFENSE)):
        for j in range(i + 1, len(DEFENSE)):
            if DEFENSE[i]["assign"] == DEFENSE[j]["assign"]:
                raise SystemExit(f"defensive calls {DEFENSE[i]['name']} and {DEFENSE[j]['name']} are identical")

    pages = {}
    for pl in OFFENSE:
        pages.setdefault(pl.get("page", 1), []).append(pl)
    for pg, plays in sorted(pages.items()):
        if len(plays) != 9:
            raise SystemExit(f"page {pg} has {len(plays)} plays, expected 9")

    doc = {
        "meta": {
            "generated": "tools/build-playbook.py",
            "shared": True,
            "note": (
                "ONE playbook for all 32 clubs. Clubs differ by player ratings, never by "
                "plays -- the arcade-football convention this game follows. Nothing here is "
                "keyed by club, so the rule cannot be broken by adding data."
            ),
            "offSlots": OFF_SLOTS,
            "defSlots": DEF_SLOTS,
            "units": "x across field in yards from centre (+-24), y downfield in yards from scrimmage",
            "tickRate": 60,
        },
        "formation": {"offense": FORMATION, "defense": DEF_FORMATION},
        "pages": len(pages),
        "offense": OFFENSE,
        "defense": DEFENSE,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"[playbook] {len(OFFENSE)} offensive ({len(pages)} pages of 9), {len(DEFENSE)} defensive -> {OUT.relative_to(ROOT)}")
    print(f"           closest two plays differ by {worst:.1f} yd mean at the route ends (min {MIN_SEP})")
    print(f"           shared by all clubs; slot names match src/data/players.json")


if __name__ == "__main__":
    main()
