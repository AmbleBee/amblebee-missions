"""Loads and checks the mission catalog (shared by check_missions.py and build_catalog.py).

Self-contained: needs only PyYAML, so it works in the public missions repo on its own.

Catalog layout (see missions/SCHEMA.md):
    missions/catalog.yaml           source information
    missions/<pack>/pack.yaml       pack information (none for general/)
    missions/<pack>/<id>.yaml       one mission per file; file name = id, folder = pack
Files starting with "_" (like _template.yaml) are ignored.
"""
import datetime
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
    "discounts": {"senior", "military", "first-responder", "healthcare", "educator", "student", "government", "local", "birthday"},
}
KNOWN = set(REQUIRED) | set(ALLOWED) | set(LIST_ALLOWED) | {"place", "for_kids", "steps", "routine", "tags", "gear", "credit",
                                                              "caution", "caution_until", "draft", "themes"}
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
# Themes: the fixed set of filter chips on the website (and later the Hive). Picked 2026-10-29 from
# the 800-odd free-form tags. Optional on missions for now; tools/suggest_themes.py fills them in from tags.
# Order here is the order the chips show in. Don't add themes that repeat a field (cost, setting, who, season).
THEMES = {
    "views": "Views & lookouts",
    "hiking": "Hiking",
    "walks": "Easy walks & strolls",
    "waterfalls": "Waterfalls",
    "beach": "Beaches & coast",
    "lakes-rivers": "Lakes, rivers & wetlands",
    "mountains": "Mountains",
    "deserts": "Deserts",
    "swimming": "Swimming & springs",
    "boating": "Out on the water",
    "caves": "Caves & underground",
    "rocks-fossils": "Rocks & fossils",
    "forests": "Forests & fall color",
    "parks": "National & state parks",
    "wildlife": "Animals & wildlife",
    "gardens": "Gardens & flowers",
    "stars": "Stars & space",
    "biking": "Biking",
    "picnic": "Picnics",
    "sunsets": "Sunrise & sunset",
    "history": "History",
    "museums": "Museums",
    "science": "Science & discovery",
    "art": "Art",
    "architecture": "Architecture & bridges",
    "vehicles": "Planes, trains & cars",
    "spooky": "Spooky & mysterious",
    "food": "Food & treats",
    "drinks": "Wine, beer & cocktails",
    "markets": "Markets & shopping",
    "movies": "Movies",
    "shows": "Music & shows",
    "games": "Games & arcades",
    "thrills": "Rides & thrills",
    "quirky": "Quirky & roadside",
    "holidays": "Holidays & festivals",
    "road-trips": "Scenic drives & road trips",
    "playful": "Playful & silly",
    "romantic": "Romantic",
    "relaxing": "Calm & cozy",
    "small-towns": "Small towns",
    "make-something": "Make or learn something",
}
THEMES_MAX = 6          # more than this and a mission shows up under every chip, which makes filtering useless
THEMES_REQUIRED = False  # flip to True once every mission has themes; until then a missing themes line is fine

RENT = {"on-site", "nearby", "no"}
PLACE_KEYS = {"name", "area", "address", "coords", "website", "links"}
LINKS_MAX, LINK_LABEL_MAX = 3, 25  # extra place links: short labels so the buttons fit on a phone
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CREDIT_MAX = 40  # shown as "Suggested by …" under the mission title
SHORT_MAX = 100
CAUTION_MAX = 200  # the yellow box on the website ticket; about 3 lines on a phone, so shorter is better


def caution_until_date(v):
    """caution_until as a date, or None if it's missing or not a real YYYY-MM-DD date."""
    if isinstance(v, datetime.datetime):
        return v.date()
    if isinstance(v, datetime.date):
        return v
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.strip()):
        try:
            return datetime.date.fromisoformat(v.strip())
        except ValueError:
            return None
    return None


def expired_cautions(missions, today=None):
    """Missions whose caution has passed its caution_until date (the website already hides these;
    this is a reminder to delete the two lines). Never an error, so a date passing can't break a build."""
    today = today or datetime.date.today()
    out = []
    for m in missions:
        d = caution_until_date(m.get("caution_until"))
        if m.get("caution") and d and d < today:
            out.append((m, d))
    return out


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
            except ValueError as e:  # e.g. an impossible date like caution_until: 2026-13-40
                raise ValueError(f"{f}: has a value that isn't valid ({e}); dates are YYYY-MM-DD") from e
            m = {**DEFAULTS, **m, "id": f.stem, "pack": folder.name, "file": str(f)}
            m["full_id"] = f"{source}/{f.stem}"
            d = caution_until_date(m.get("caution_until"))
            if d:
                m["caution_until"] = d.isoformat()
            missions.append(m)
    # drafts (draft: true) stay in the repo but are left out of the site, so they don't count
    for pid, p in packs.items():
        p["count"] = sum(1 for m in missions if m["pack"] == pid and not m.get("draft"))
        p["drafts"] = sum(1 for m in missions if m["pack"] == pid and m.get("draft"))
    if not packs["general"]["count"] and not packs["general"]["drafts"]:
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
        # themes: optional for now (THEMES_REQUIRED), but when the line is there every word must be on the list
        if "themes" not in m or m["themes"] in (None, []):
            if THEMES_REQUIRED:
                problems.append(f"{where}: needs themes (pick 1-{THEMES_MAX} from the theme list in SCHEMA.md)")
        elif not isinstance(m["themes"], list):
            problems.append(f"{where}: themes should be a list in square brackets, like `themes: [views, hiking]`")
        else:
            bad = [t for t in m["themes"] if t not in THEMES]
            if bad:
                problems.append(f"{where}: themes has {bad}, which isn't on the theme list (SCHEMA.md → Themes); "
                                f"free-form words go in tags instead")
            if len(set(map(str, m["themes"]))) != len(m["themes"]):
                problems.append(f"{where}: themes lists the same theme twice")
            if len(m["themes"]) > THEMES_MAX:
                problems.append(f"{where}: themes has {len(m['themes'])}; keep it to {THEMES_MAX} that really fit")
            # "romantic" is a date filter; on an adventure-only mission it would hand someone a family trip
            if "romantic" in m["themes"] and m.get("mode") == "adventure":
                problems.append(f"{where}: themes has romantic, but mode is adventure (no dates); "
                                "drop romantic, or make the mode date or both")
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
        # Amble Anywhere missions work wherever you are, so no place; every other Amble pack (the
        # state packs) is about a real spot, so it needs a place with coords (Near you and distances use them)
        pack_name = str(packs.get(m["pack"], {}).get("name") or "")
        if m["pack"] == "anywhere":
            if m.get("place"):
                problems.append(f"{where}: Amble Anywhere missions work anywhere, so leave out place "
                                f"(or move the mission to its state's pack)")
        elif pack_name.startswith("Amble "):
            if not m.get("place"):
                problems.append(f"{where}: missions in {pack_name} need a place with a name and coords")
            elif not (m["place"] or {}).get("coords"):
                problems.append(f"{where}: place has no coords, so it won't show under Near you or get a distance. "
                                f"Add coords: [latitude, longitude] (the entrance, dock or trailhead, 5 decimals)")
        if "place" in m:
            place = m["place"] or {}
            if "name" not in place:
                problems.append(f"{where}: place needs at least a name")
            if "coords" in place:
                c = place["coords"]
                if not (isinstance(c, list) and len(c) == 2 and all(isinstance(v, (int, float)) for v in c)
                        and -90 <= c[0] <= 90 and -180 <= c[1] <= 180):
                    problems.append(f"{where}: coords should be [latitude, longitude], e.g. [45.52266, -122.67306]")
            for k in sorted(set(place) - PLACE_KEYS):
                hint = {"link": "links", "url": "website", "site": "website", "web": "website", "coord": "coords"}.get(k)
                problems.append(f"{where}: place has '{k}', which isn't a place field" + (f" (did you mean '{hint}'?)" if hint else ""))
            w = place.get("website")
            if w not in (None, "") and not (isinstance(w, str) and w.startswith(("https://", "http://"))):
                problems.append(f"{where}: place website should start with https://")
            if "links" in place:
                links = place["links"]
                if not isinstance(links, list) or not links:
                    problems.append(f"{where}: place links should be a list, each with a label and a url")
                else:
                    if len(links) > LINKS_MAX:
                        problems.append(f"{where}: place has {len(links)} links; keep it to {LINKS_MAX} extras")
                    for i, l in enumerate(links, 1):
                        if not isinstance(l, dict) or set(l) - {"label", "url"}:
                            problems.append(f"{where}: place link {i} should have just a label and a url")
                            continue
                        label, url = str(l.get("label") or "").strip(), l.get("url")
                        if not label:
                            problems.append(f"{where}: place link {i} needs a label (the button text, like \"Bike rentals\")")
                        elif len(label) > LINK_LABEL_MAX:
                            problems.append(f"{where}: place link {i} label is {len(label)} characters; keep it to {LINK_LABEL_MAX}")
                        if not (isinstance(url, str) and url.startswith(("https://", "http://"))):
                            problems.append(f"{where}: place link {i} url should start with https://")
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
        if "draft" in m and not isinstance(m["draft"], bool):
            problems.append(f"{where}: draft should be true or false (or leave the line out)")
        # caution: one short warning shown in a yellow box on the website ticket (never on the camera)
        ca = m.get("caution")
        if "caution" in m and ca not in (None, ""):
            if not isinstance(ca, str) or not ca.strip():
                problems.append(f"{where}: caution should be one sentence of text")
            elif len(ca.strip()) > CAUTION_MAX:
                problems.append(f"{where}: caution is {len(ca.strip())} characters; keep it to {CAUTION_MAX} "
                                f"(it sits in a small box on the ticket, about 3 lines on a phone)")
        if "caution_until" in m and m["caution_until"] not in (None, ""):
            if not (isinstance(ca, str) and ca.strip()):
                problems.append(f"{where}: caution_until is set but there's no caution for it to end")
            if not caution_until_date(m["caution_until"]):
                problems.append(f"{where}: caution_until should be a date like 2026-12-01 (YYYY-MM-DD)")
        for g in m.get("gear") or []:
            if not isinstance(g, dict) or g.get("item") not in GEAR:
                problems.append(f"{where}: gear item {g.get('item') if isinstance(g, dict) else g!r} isn't in the gear list (SCHEMA.md)")
            elif "rent" in g and g["rent"] not in RENT:
                problems.append(f"{where}: gear rent '{g['rent']}' should be one of {sorted(RENT)}")
    return problems
