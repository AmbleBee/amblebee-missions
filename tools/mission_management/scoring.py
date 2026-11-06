"""Scoring settings: what the dashboard calls balanced, kept in scoring.yaml next to the manager.

scoring.default.yaml ships with the manager. On first run it's copied to scoring.yaml, which is the person's
own copy: the Settings page edits it, git ignores it, and it never goes into a pack repo. So each person can
judge their packs their own way without changing anyone else's.

    settings, note = load()          # always usable; a broken file falls back to the defaults, with a note
    rules = for_pack(settings, "oregon")
    save(settings)                   # from the Settings page
    reset()                          # back to the defaults
"""
import copy
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
DEFAULT_FILE = HERE / "scoring.default.yaml"
FILE = HERE / "scoring.yaml"

DIMS = {   # the words around each balance; the numbers come from the settings file
    "setting": {"label": "Indoor share", "side_a": "indoor", "side_b": "outdoor"},
    "cost": {"label": "Cheap share (free or $)", "side_a": "cheap", "side_b": "pricier"},
    "mode": {"label": "Date share", "side_a": "date", "side_b": "adventure"},
    "season": {"label": "Winter share", "side_a": "winter-friendly", "side_b": "warm-season only"},
    "time": {"label": "Evening share", "side_a": "evening", "side_b": "daytime"},
}
BUILT_IN = {   # used when even scoring.default.yaml is missing
    "version": 1,
    "balance": {"setting": {"low": 0.25, "high": 0.60}, "cost": {"low": 0.40, "high": 0.80},
                "mode": {"low": 0.35, "high": 0.65}, "season": {"low": 0.40, "high": 1.0},
                "time": {"low": 0.15, "high": 0.60}},
    "show": ["setting", "cost", "mode", "season", "time"],
    "top_theme_max": 0.40, "min_missions": 10, "stale_days": 182,
    "packs": {"anywhere": {"gap_finder": False}},
}


def _read(path):
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError("it should be settings like `min_missions: 10`")
    return data


def defaults():
    try:
        return normalize(_read(DEFAULT_FILE))[0]
    except (OSError, ValueError, yaml.YAMLError):
        return copy.deepcopy(BUILT_IN)


def _share(v):
    """0.25, 25 or "25%" all mean a quarter. None when it isn't a share."""
    if isinstance(v, str):
        v = v.strip().rstrip("%")
        try:
            v = float(v)
        except ValueError:
            return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = v / 100 if v > 1 else float(v)
    return round(v, 4) if 0 <= v <= 1 else None


def _band(v, fallback, where, notes):
    if isinstance(v, dict):
        lo, hi = _share(v.get("low")), _share(v.get("high"))
        if lo is not None and hi is not None and lo <= hi:
            return {"low": lo, "high": hi}
    notes.append(f"{where}: needs low and high between 0 and 1 (low first); using {fallback['low']}-{fallback['high']}")
    return dict(fallback)


def _off(v):
    return v is False or (isinstance(v, str) and v.strip().lower() in ("off", "no", "false"))


def normalize(data, base=None):
    """(settings, notes): data with every value checked, anything missing or broken taken from base."""
    base = base or BUILT_IN
    notes = []
    out = {"version": 1, "balance": {}, "packs": {}}
    bal = data.get("balance") if isinstance(data.get("balance"), dict) else {}
    for dim in DIMS:
        out["balance"][dim] = _band(bal[dim], base["balance"][dim], f"balance.{dim}", notes) if dim in bal \
            else dict(base["balance"][dim])
    show = data.get("show", base.get("show", list(DIMS)))
    if not isinstance(show, list) or any(d not in DIMS for d in show):
        notes.append(f"show: should be a list of {', '.join(DIMS)}; showing all of them")
        show = list(DIMS)
    out["show"] = [d for d in DIMS if d in show]          # always in the same order
    t = _share(data.get("top_theme_max", base["top_theme_max"]))
    out["top_theme_max"] = t if t is not None else base["top_theme_max"]
    for key in ("min_missions", "stale_days"):
        v = data.get(key, base[key])
        out[key] = v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else base[key]
        if out[key] != v:
            notes.append(f"{key}: should be a whole number; using {base[key]}")
    packs = data.get("packs") if isinstance(data.get("packs"), dict) else {}
    for pid, p in packs.items():
        if not isinstance(p, dict):
            continue
        rule = {}
        if "gap_finder" in p:
            rule["gap_finder"] = not _off(p["gap_finder"]) and p["gap_finder"] is not None
        for dim in DIMS:
            if dim in p:
                rule[dim] = "off" if _off(p[dim]) else _band(p[dim], out["balance"][dim], f"packs.{pid}.{dim}", notes)
        if "top_theme" in p:
            t = _share(p["top_theme"])
            rule["top_theme"] = "off" if _off(p["top_theme"]) or t is None else t
        if rule:
            out["packs"][str(pid)] = rule
    return out, notes


def load():
    """(settings, note). Creates scoring.yaml from the defaults the first time."""
    if not FILE.exists():
        try:
            FILE.write_text(DEFAULT_FILE.read_text(encoding="utf-8") if DEFAULT_FILE.exists()
                            else render(BUILT_IN), encoding="utf-8")
        except OSError:
            return defaults(), "Couldn't create scoring.yaml next to the manager, so the defaults are in use."
    try:
        settings, notes = normalize(_read(FILE), defaults())
    except (OSError, ValueError, yaml.YAMLError) as e:
        return defaults(), f"scoring.yaml couldn't be read ({e}), so the defaults are in use until it's fixed or reset."
    return settings, "; ".join(notes)


def for_pack(settings, pid):
    """The rules one pack is judged by: {dims: {dim: band or None}, top_theme_max (None = off), gap_finder}."""
    rule = settings["packs"].get(pid, {})
    dims = {}
    for dim, words in DIMS.items():
        if dim not in settings["show"]:      # hidden in Settings: not shown, not judged
            continue
        band = rule.get(dim, settings["balance"][dim])
        dims[dim] = None if band == "off" else {**words, **band}
    top = rule.get("top_theme", settings["top_theme_max"])
    return {"dims": dims, "top_theme_max": None if top == "off" else top,
            "gap_finder": rule.get("gap_finder", True)}


def _num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)


def render(settings):
    """scoring.yaml text for these settings, with the same notes as the defaults file."""
    s = settings
    lines = ["# Mission manager scoring: your own copy (the Settings page edits it; git never sees it).",
             "# Defaults: scoring.default.yaml. Shares run 0-1; \"either\" and \"both\" count half each way.",
             "version: 1", "", "balance:"]
    notes = {"setting": "indoor share", "cost": "cheap share (free or $)", "mode": "date share",
             "season": "missions you can do in winter (any season counts)", "time": "evening or night ('any' counts half)"}
    for dim in DIMS:
        b = s["balance"][dim]
        lines.append(f"  {dim}: {{low: {_num(b['low'])}, high: {_num(b['high'])}}}   # {notes[dim]}")
    lines += ["", f"show: [{', '.join(s['show'])}]   # the balance bars shown and judged, in this order"]
    lines += ["", f"top_theme_max: {_num(s['top_theme_max'])}   # one theme on more than this share = the pack leans on it",
              f"min_missions: {s['min_missions']}   # fewer and a pack isn't ranked",
              f"stale_days: {s['stale_days']}   # a live mission checked longer ago than this needs a fresh look",
              "", "# Per-pack exceptions: gap_finder: false | setting/cost/mode: off or {low, high} | top_theme: off or a share",
              "packs:" + ("" if s["packs"] else " {}")]
    for pid in sorted(s["packs"]):
        lines.append(f"  {pid}:")
        for k, v in s["packs"][pid].items():
            if isinstance(v, dict):
                v = f"{{low: {_num(v['low'])}, high: {_num(v['high'])}}}"
            elif isinstance(v, bool):
                v = "true" if v else "false"
            else:
                v = _num(v)
            lines.append(f"    {k}: {v}")
    return "\n".join(lines) + "\n"


def save(data):
    """Checks what the Settings page sent, writes it, and returns (settings, notes)."""
    settings, notes = normalize(data if isinstance(data, dict) else {}, defaults())
    tmp = FILE.with_name(".scoring.yaml.tmp")
    tmp.write_text(render(settings), encoding="utf-8")
    tmp.replace(FILE)
    return settings, notes


def reset():
    FILE.write_text(DEFAULT_FILE.read_text(encoding="utf-8") if DEFAULT_FILE.exists() else render(BUILT_IN),
                    encoding="utf-8")
    return load()
