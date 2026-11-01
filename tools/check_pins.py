"""Check that each mission's map pin is in its pack's state.

    python tools/check_pins.py               # check missions/
    python tools/check_pins.py other/folder  # check another catalog folder

Works offline from data/cities.json (Census places with their state), so nothing is looked up online.

Two kinds of finding:
  error    a live mission's pin is well outside its pack's state: swapped latitude and longitude, a missing
           minus sign, or a mission filed in the wrong pack. Errors stop the deploy.
  warning  the pin is inside the state's area, but the closest town is across a border (Portland or
           Vancouver?). Real border spots happen, so this only reports. Drafts only ever get warnings.
           Once you've checked a border spot on a map, add it to tools/border_spots.txt to quiet it.

This can't tell whether a pin is on the right building or trailhead. That still takes a look on a map.
Packs whose region isn't a state (Amble Anywhere) are skipped.
"""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from missions_lib import load_catalog  # noqa: E402

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
    "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}
NAMES = {v: k for k, v in STATES.items()}
PAD = 0.35      # degrees of slack around a state's towns (about 25 miles), for parks and coast that sit past the last town
NEAREST = 8     # how many of the closest towns to look at for the border warning
NEAR_KM = 6     # a pin this close to a town in its own state is never "across the border"
BIG_CITIES = 10  # the Census treats a big city as one point (all of New York City sits in Brooklyn),
BIG_KM = 30      # so the biggest few count from this far away


def lon360(lon):
    """Alaska's Aleutians cross the date line; keeping longitudes west of it as negative keeps boxes sane."""
    return lon - 360 if lon > 0 else lon


def load_places(path):
    rows = json.loads(Path(path).read_text(encoding="utf-8"))["cities"]
    # cities.json lists the most people first, so a place's position is its size rank
    places = [(st, lat, lon360(lon), rank) for rank, (_name, st, lat, lon) in enumerate(rows) if st in NAMES]
    boxes = {}
    for st, lat, lon, _rank in places:
        b = boxes.setdefault(st, [lat, lat, lon, lon])
        b[0], b[1], b[2], b[3] = min(b[0], lat), max(b[1], lat), min(b[2], lon), max(b[3], lon)
    grid = {}
    for p in places:
        grid.setdefault((math.floor(p[1]), math.floor(p[2])), []).append(p)
    return boxes, grid


def km(lat, lon, p):
    return 111.2 * math.hypot(p[1] - lat, (p[2] - lon) * math.cos(math.radians(lat)))


def nearby(grid, lat, lon):
    """The towns around the pin, closest first, searching outward from its 1-degree square."""
    found, reach = [], 0
    while len(found) < NEAREST and reach < 6:
        reach += 1
        found = [p for dy in range(-reach, reach + 1) for dx in range(-reach, reach + 1)
                 for p in grid.get((math.floor(lat) + dy, math.floor(lon) + dx), [])]
    return sorted(found, key=lambda p: km(lat, lon, p))


def nearest_states(grid, lat, lon):
    return [p[0] for p in nearby(grid, lat, lon)[:NEAREST]]


def at_home(grid, lat, lon, st):
    """True when a town in the pack's own state is right there: very close, or a big city within its sprawl."""
    return any(p[0] == st and (km(lat, lon, p) <= NEAR_KM or (p[3] < BIG_CITIES and km(lat, lon, p) <= BIG_KM))
               for p in nearby(grid, lat, lon))


def load_checked(path):
    """Missions already confirmed as real border spots (tools/border_spots.txt), as "pack/id"."""
    if not Path(path).exists():
        return set()
    return {line.split("#")[0].strip() for line in Path(path).read_text(encoding="utf-8").splitlines()} - {""}


def check(folder, cities, checked_file):
    _info, packs, missions = load_catalog(folder)
    boxes, grid = load_places(cities)
    border_ok = load_checked(checked_file)
    errors, warnings, checked = [], [], 0
    for m in missions:
        st = STATES.get(str(packs.get(m["pack"], {}).get("region") or "").strip())
        c = (m.get("place") or {}).get("coords")
        if not st or not isinstance(c, (list, tuple)) or len(c) != 2:
            continue   # not a state pack, or no pin (check_missions.py reports missing pins)
        checked += 1
        lat, lon = float(c[0]), lon360(float(c[1]))
        where = f"{m['pack']}/{m['id']}" + (" (draft)" if m.get("draft") else "")
        lo_lat, hi_lat, lo_lon, hi_lon = boxes[st]
        if not (lo_lat - PAD <= lat <= hi_lat + PAD and lo_lon - PAD <= lon <= hi_lon + PAD):
            near = nearest_states(grid, lat, lon)
            guess = f" It looks like {NAMES[near[0]]}." if near else ""
            hint = " Are latitude and longitude swapped?" if -180 <= c[0] <= -60 and 15 <= c[1] <= 75 else ""
            msg = f"{where}: pin {c[0]}, {c[1]} is outside {NAMES[st]}.{guess}{hint}"
            (warnings if m.get("draft") else errors).append(msg)
            continue
        near = nearest_states(grid, lat, lon)
        if near and near[0] != st and not at_home(grid, lat, lon, st) and f"{m['pack']}/{m['id']}" not in border_ok:
            warnings.append(f"{where}: pin {c[0]}, {c[1]} is near the edge of {NAMES[st]}, and the closest town is "
                            f"in {NAMES[near[0]]}. If it's a real border spot, check it on a map and add it to tools/border_spots.txt.")
    return checked, errors, warnings


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=str(ROOT / "missions"))
    ap.add_argument("--cities", default=str(ROOT / "data" / "cities.json"))
    ap.add_argument("--checked", default=str(ROOT / "tools" / "border_spots.txt"))
    args = ap.parse_args()
    checked, errors, warnings = check(args.folder, args.cities, args.checked)
    for w in warnings:
        print(f"Warning: {w}")
    for e in errors:
        print(f"Error: {e}")
    if errors:
        raise SystemExit(f"\n{len(errors)} pin(s) outside their pack's state. Fix the coords or move the mission, "
                         f"or mark it draft: true until it's checked.")
    print(f"Pins OK: {checked} state-pack missions are in their state" + (f" ({len(warnings)} to look at)" if warnings else ""))


if __name__ == "__main__":
    main()
