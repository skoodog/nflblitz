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
    {
        "id": "slot_cross", "name": "SLOT CROSS", "kind": "pass", "depth": 12, "clock": 78,
        "note": "Two crossers underneath a clear-out. The staple.",
        "routes": {
            "REC1": [[-14, 0], [-11, 7], [6, 11]],
            "REC2": [[9, 0], [7, 9], [-8, 13]],
            "REC3": [[-4.5, -1], [-6, 4], [-3, 7]],
        },
    },
    {
        "id": "post_wheel", "name": "POST + WHEEL", "kind": "pass", "depth": 26, "clock": 116,
        "note": "Deep shot. Wheel holds the corner, post breaks in behind it.",
        "routes": {
            "REC1": [[-14, 0], [-13, 14], [-3, 27]],
            "REC2": [[9, 0], [13, 6], [12, 26]],
            "REC3": [[-4.5, -1], [-4, 5], [-4, 9]],
        },
    },
    {
        "id": "quick_slants", "name": "QUICK SLANTS", "kind": "pass", "depth": 7, "clock": 46,
        "note": "Beats pressure. Fastest read on the sheet.",
        "routes": {
            "REC1": [[-14, 0], [-10, 6], [-4, 9]],
            "REC2": [[9, 0], [5, 6], [0, 9]],
            "REC3": [[-4.5, -1], [-1, 4], [3, 6]],
        },
    },
    {
        "id": "corner_flood", "name": "CORNER FLOOD", "kind": "pass", "depth": 18, "clock": 94,
        "note": "Three levels at one sideline. Somebody is open.",
        "routes": {
            "REC1": [[-14, 0], [-15, 9], [-19, 18]],
            "REC2": [[9, 0], [-2, 5], [-13, 9]],
            "REC3": [[-4.5, -1], [-9, 2], [-16, 3]],
        },
    },
    {
        "id": "seam_go", "name": "DOUBLE SEAM", "kind": "pass", "depth": 30, "clock": 124,
        "note": "Both seams vertical. Max protection, one read, all or nothing.",
        "routes": {
            "REC1": [[-14, 0], [-9, 15], [-8, 32]],
            "REC2": [[9, 0], [5, 15], [6, 32]],
            "REC3": [[-4.5, -1], [-4.5, 3], [-4.5, 6]],
        },
    },
    {
        "id": "screen_left", "name": "SCREEN LEFT", "kind": "screen", "depth": 2, "clock": 62,
        "note": "Let them come, then throw behind the rush with blockers ahead.",
        "routes": {
            "REC1": [[-14, 0], [-16, 2], [-18, 4]],
            "REC2": [[9, 0], [9, 10], [9, 18]],
            "REC3": [[-4.5, -1], [-9, -3], [-13, -2]],
        },
        "primary": "REC3",
    },
    {
        "id": "power_right", "name": "POWER RIGHT", "kind": "run", "depth": 0, "clock": 30,
        "note": "Hand it off behind the right gap and run downhill.",
        "gap": 3.0,
        "routes": {
            "REC1": [[-14, 0], [-12, 4], [-10, 8]],
            "REC2": [[9, 0], [8, 3], [7, 6]],
            "REC3": [[-4.5, -1], [1, 0], [6, 4]],
        },
        "primary": "REC3",
    },
    {
        "id": "qb_keeper", "name": "QB KEEPER", "kind": "run", "depth": 0, "clock": 30,
        "note": "The quarterback keeps it. Nobody blocks the edge for you.",
        "gap": -3.0,
        "routes": {
            "REC1": [[-14, 0], [-13, 6], [-13, 12]],
            "REC2": [[9, 0], [9, 6], [9, 12]],
            "REC3": [[-4.5, -1], [-8, 1], [-12, 2]],
        },
        "primary": "QB",
    },
]

# ---------------------------------------------------------------- defence ----
# Names are the eight on the concept art's DEFENSE! PICK A PLAY screen, so the playcall
# UI and the simulation agree on one vocabulary.
#
# rush   = how many of the seven attack the passer
# cover  = 'man' | 'zone' | 'mixed'
# risk   = 0..1, how much this call gives up if it is beaten. The playcall screen sorts
#          on it, so a player can read aggression off the sheet without a manual.
DEFENSE = [
    {"id": "safe_cover", "name": "SAFE COVER", "rush": 2, "cover": "zone", "risk": 0.10,
     "note": "Everyone back. Gives up the underneath, gives up nothing deep.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "zone_hook",
                "DB1": "zone_deep", "DB2": "zone_deep", "DB3": "zone_flat", "DB4": "zone_deep"}},
    {"id": "stuff_it", "name": "STUFF IT", "rush": 3, "cover": "man", "risk": 0.30,
     "note": "Crowd the line. Built to kill a run before it starts.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "rush",
                "DB1": "man", "DB2": "man", "DB3": "spy", "DB4": "zone_deep"}},
    {"id": "two_man_blitz", "name": "2 MAN BLITZ", "rush": 4, "cover": "man", "risk": 0.55,
     "note": "Four after the passer, man behind it.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "rush",
                "DB1": "man", "DB2": "man", "DB3": "rush", "DB4": "zone_deep"}},
    {"id": "zone_hook", "name": "ZONE HOOK", "rush": 2, "cover": "zone", "risk": 0.20,
     "note": "Sit in the throwing lanes and wait for the mistake.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "zone_hook",
                "DB1": "zone_hook", "DB2": "zone_hook", "DB3": "zone_flat", "DB4": "zone_deep"}},
    {"id": "slam_wall", "name": "SLAM WALL", "rush": 3, "cover": "zone", "risk": 0.35,
     "note": "A wall at the sticks. Nothing crosses cheaply.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "rush",
                "DB1": "zone_flat", "DB2": "zone_flat", "DB3": "zone_hook", "DB4": "zone_deep"}},
    # Two rushers plus an edge contain, NOT three: the declared count and the assignment
    # table disagreed here and the validator caught it. Contain is a real assignment --
    # it holds the edge against a keeper instead of crashing inside -- so the honest fix
    # was to correct the count, not to delete the concept. Risk sits below the 3-rusher
    # calls accordingly.
    {"id": "lb_attack", "name": "LB ATTACK", "rush": 2, "cover": "mixed", "risk": 0.38,
     "note": "The rover comes clean up the middle while the edge stays home.",
     "assign": {"RUSH1": "rush", "RUSH2": "contain", "ROVER": "rush",
                "DB1": "man", "DB2": "man", "DB3": "zone_hook", "DB4": "zone_deep"}},
    {"id": "in_your_face", "name": "IN YOUR FACE", "rush": 4, "cover": "man", "risk": 0.70,
     "note": "Press every receiver at the line. No cushion anywhere.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "rush",
                "DB1": "press", "DB2": "press", "DB3": "press", "DB4": "rush"}},
    {"id": "death_wish", "name": "DEATH WISH", "rush": 6, "cover": "man", "risk": 1.00,
     "note": "Everyone but one. Sack or touchdown, nothing between.",
     "assign": {"RUSH1": "rush", "RUSH2": "rush", "ROVER": "rush",
                "DB1": "rush", "DB2": "rush", "DB3": "rush", "DB4": "man"}},
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
        "offense": OFFENSE,
        "defense": DEFENSE,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"[playbook] {len(OFFENSE)} offensive, {len(DEFENSE)} defensive -> {OUT.relative_to(ROOT)}")
    print(f"           shared by all clubs; slot names match src/data/players.json")


if __name__ == "__main__":
    main()
