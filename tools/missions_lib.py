"""Loads and checks the mission catalog (shared by check_missions.py and build_catalog.py).

Self-contained: needs only PyYAML, so it works in the public missions repo on its own.

Catalog layout (see missions/SCHEMA.md):
    missions/catalog.yaml           source information
    missions/<pack>/pack.yaml       pack information (none for general/)
    missions/<pack>/<id>.yaml       one mission per file; file name = id, folder = pack
Files starting with "_" (like _template.yaml) are ignored.
"""
import random
import re
from pathlib import Path

import yaml

DEFAULTS = {"cost": "$", "setting": "either", "season": "any", "time_of_day": "any",
            "travel": "local", "routine": False, "tags": []}

REQUIRED = ["number", "name", "mode", "short", "description", "duration", "effort"]
ALLOWED = {
    "mode": {"date", "adventure", "both"},
    "duration": {"short", "half-day", "all-day"},
    "effort": {"easy", "moderate", "hard"},
    "cost": {"free", "$", "$$", "$$$"},
    "setting": {"indoor", "outdoor", "either"},
    "time_of_day": {"any", "morning", "daytime", "evening", "night"},
    "travel": {"home", "local", "drive", "day-trip"},
}
LIST_ALLOWED = {
    "who": {"solo", "friends", "family", "kids"},
    "check_ahead": {"hours", "tickets", "reservation", "seasonal", "conditions"},
    "season": {"spring", "summer", "fall", "winter"},
}
KNOWN = set(REQUIRED) | set(ALLOWED) | set(LIST_ALLOWED) | {"place", "for_kids", "steps", "routine", "tags", "gear", "credit"}
GEAR = {
    # Water
    "kayak", "canoe", "paddleboard", "life-jackets", "wetsuit", "river-tube", "fishing-gear",
    # Camping
    "tent", "sleeping-bags", "camp-stove", "hammock",
    # Snow
    "snowshoes", "skis", "snowboard", "sled", "traction-spikes",
    # Wheels / cooking / sky / climbing
    "bikes", "roller-skates", "grill", "telescope", "binoculars", "climbing-gear", "headlamps",
    # Games and sport / getting there
    "golf-clubs", "disc-golf-discs", "tennis-rackets", "kite", "high-clearance-vehicle",
}
RENT = {"on-site", "nearby", "no"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CREDIT_MAX = 40  # shown as "Suggested by …" under the mission title
SHORT_MAX = 100


def _read(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_catalog(root):
    """Returns (catalog_info, packs, missions). Raises ValueError on files that can't be read."""
    root = Path(root)
    info = _read(root / "catalog.yaml")
    source = info.get("source_id", "local")
    packs, missions = {"general": {"id": "general", "name": "General"}}, []
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
        if (folder / "pack.yaml").exists():
            packs[folder.name] = {"id": folder.name, **_read(folder / "pack.yaml")}
        packs.setdefault(folder.name, {"id": folder.name, "name": folder.name.title()})
        for f in sorted(folder.glob("*.yaml")):
            if f.name == "pack.yaml" or f.name.startswith("_"):
                continue
            try:
                m = _read(f)
            except yaml.YAMLError as e:
                raise ValueError(f"{f}: not valid YAML ({e})") from e
            m = {**DEFAULTS, **m, "id": f.stem, "pack": folder.name, "file": str(f)}
            m["full_id"] = f"{source}/{f.stem}"
            missions.append(m)
    for pid, p in packs.items():
        p["count"] = sum(1 for m in missions if m["pack"] == pid)
    if not packs["general"]["count"]:
        del packs["general"]  # only listed when a source actually has unpacked missions
    return info, packs, missions


def check_catalog(root):
    """Returns a list of problems (empty = all good)."""
    problems = []
    root = Path(root)
    if not (root / "catalog.yaml").exists():
        return [f"{root}/catalog.yaml is missing"]
    try:
        info, packs, missions = load_catalog(root)
    except ValueError as e:
        return [str(e)]
    for key in ("name", "source_id", "schema_version"):
        if key not in info:
            problems.append(f"catalog.yaml: missing '{key}'")

    # pack icons must be in the icon pack (icons/packs/<name>.svg next to missions/), when this catalog has one
    icon_dir = root.parent / "icons" / "packs"
    if icon_dir.is_dir():
        have = {f.stem for f in icon_dir.glob("*.svg")}
        for pid, p in packs.items():
            if pid == "general":
                continue
            icon = str(p.get("icon") or "").strip()
            if not icon:
                problems.append(f"{pid}/pack.yaml: needs an icon (a file name from icons/packs/, without .svg)")
            elif icon not in have:
                problems.append(f"{pid}/pack.yaml: icon '{icon}' isn't in icons/packs/ (add icons/packs/{icon}.svg, or pick one that's there)")

    # a pack folder without pack.yaml still loads, but shows its bare folder name ("Montana", not "Amble Montana")
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
        if folder.name != "general" and not (folder / "pack.yaml").exists():
            problems.append(f"{folder.name}/: no pack.yaml, so this pack would show as \"{folder.name.title()}\" "
                            f"instead of \"Amble {folder.name.replace('-', ' ').title()}\". Copy pack.yaml from another pack folder and edit it.")

    seen_ids, seen_numbers = {}, {}
    for m in missions:
        where = Path(m["file"]).relative_to(root)
        if not ID_RE.match(m["id"]):
            problems.append(f"{where}: file name should be lowercase letters, numbers and dashes")
        if m["id"] in seen_ids:
            problems.append(f"{where}: same file name (id) as {seen_ids[m['id']]}; ids must be unique across packs")
        seen_ids[m["id"]] = where
        for key in REQUIRED:
            if key not in m:
                problems.append(f"{where}: missing '{key}'")
        for key in m:
            if key not in KNOWN | {"id", "pack", "file", "full_id"}:
                problems.append(f"{where}: unknown field '{key}' (typo?)")
        for key, allowed in ALLOWED.items():
            if key in m and m[key] not in allowed:
                problems.append(f"{where}: {key} '{m[key]}' should be one of {sorted(allowed)}")
        for key, allowed in LIST_ALLOWED.items():
            if key not in m or (key == "season" and m[key] == "any"):
                continue
            values = m[key] if isinstance(m[key], list) else [m[key]]
            bad = [v for v in values if v not in allowed]
            if bad:
                problems.append(f"{where}: {key} has {bad}; allowed: {sorted(allowed)}")
        if isinstance(m.get("number"), int):
            key = (m["pack"], m["number"])
            if key in seen_numbers:
                problems.append(f"{where}: number {m['number']} already used in pack '{m['pack']}' by {seen_numbers[key]}")
            seen_numbers[key] = where
        elif "number" in m:
            problems.append(f"{where}: number should be a whole number")
        if len(str(m.get("short", ""))) > SHORT_MAX:
            problems.append(f"{where}: short is {len(m['short'])} characters; keep it to {SHORT_MAX} for the camera screen")
        if "kids" in m.get("who", []):
            fk = m.get("for_kids")
            if not fk or "short" not in fk or not fk.get("steps"):
                problems.append(f"{where}: who includes kids, so it needs for_kids with a short and steps")
        if "steps" in m and not (isinstance(m["steps"], list) and m["steps"]):
            problems.append(f"{where}: steps should be a list of prompts")
        if "place" in m:
            place = m["place"] or {}
            if "name" not in place:
                problems.append(f"{where}: place needs at least a name")
            if "coords" in place:
                c = place["coords"]
                if not (isinstance(c, list) and len(c) == 2 and all(isinstance(v, (int, float)) for v in c)
                        and -90 <= c[0] <= 90 and -180 <= c[1] <= 180):
                    problems.append(f"{where}: coords should be [latitude, longitude], e.g. [45.52266, -122.67306]")
        cr = m.get("credit")
        if cr not in (None, ""):  # missing or blank credit is fine: nothing shows on the ticket
            if not isinstance(cr, str) or not cr.strip():
                problems.append(f"{where}: credit should be the contributor's name as text, or leave it blank")
            elif len(cr) > CREDIT_MAX:
                problems.append(f"{where}: credit is {len(cr)} characters; keep it to {CREDIT_MAX}")
            elif "://" in cr or "@" in cr:
                problems.append(f"{where}: credit should be a name only, no links or email addresses")
            elif cr.strip()[:1] in "(\"'" or cr.strip().lower().startswith("suggested by"):
                problems.append(f"{where}: credit should be just the name, like `credit: Max W.` "
                                "(the site adds \"Suggested by\" itself; no brackets or quotes)")
        for g in m.get("gear") or []:
            if not isinstance(g, dict) or g.get("item") not in GEAR:
                problems.append(f"{where}: gear item {g.get('item') if isinstance(g, dict) else g!r} isn't in the gear list (SCHEMA.md)")
            elif "rent" in g and g["rent"] not in RENT:
                problems.append(f"{where}: gear rent '{g['rent']}' should be one of {sorted(RENT)}")
    return problems
