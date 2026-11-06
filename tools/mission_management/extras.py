"""The manager's bigger actions, each checked before anything is written:

    edit_pack(root, missions, data, dry)    change a pack.yaml (never its folder name); refused if any mission would fail
    bulk(root, missions, body)             one change to many missions at once; all of them pass the checks or none save
    ideas: load_ideas / save_ideas         a scratch list of mission ideas in mission-ideas.yaml, kept out of git
    release(root, missions, pack)          a pack's live missions as a zip to send someone, with its checksum
    reveal(path)                           show a file in the computer's file browser
"""
import datetime
import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import yaml

import amble_checks as lib
from writer import dump_mission, scalar

PACK_KEYS = ("name", "region", "description", "icon", "places")
PACK_LIMITS = {"name": 40, "region": 40, "description": 200}
IDEAS_FILE = "mission-ideas.yaml"
RELEASES = "releases"


def _check_copy(missions, changes, root=None):
    """check_catalog() on a copy of missions/ with {relative path: new text} written in. Returns its problems."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        shutil.copytree(missions, tmp / "missions", ignore=shutil.ignore_patterns(".*"))
        if root and (Path(root) / "icons").exists():
            (tmp / "icons").symlink_to(Path(root) / "icons")
        for rel, text in changes.items():
            (tmp / "missions" / rel).write_text(text, encoding="utf-8")
        return lib.check_catalog(tmp / "missions")


def _diff(old, new, label):
    return list(difflib.unified_diff(old.splitlines(), new.splitlines(), label, label, lineterm="", n=1))[2:]


# ---------- edit a pack ----------

def _replace_key(text, key, line):
    """text with key's top-level block (its line plus any indented lines under it) replaced by `line`,
    or `line` added at the end when the key isn't there. Comments elsewhere are untouched."""
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if l.startswith(f"{key}:"):
            j = i + 1
            while j < len(lines) and (lines[j].startswith((" ", "\t")) or not lines[j].strip()):
                j += 1
            while j > i + 1 and not lines[j - 1].strip():      # keep blank lines that separate the next block
                j -= 1
            return "\n".join(lines[:i] + ([line] if line else []) + lines[j:]) + "\n"
    return (text.rstrip("\n") + "\n" + line + "\n") if line else text


def edit_pack(root, missions, data, dry=True):
    """(code, result). dry: only work out the change. Live missions and installed Hives see a pack's new
    name and description on their next update, so the manager asks first; the folder name never changes."""
    pid = str(data.get("id") or "")
    path = Path(missions) / pid / "pack.yaml"
    if not lib.ID_RE.match(pid) or not path.exists():
        return 404, {"error": f"No pack.yaml for a pack called {pid}."}
    old = path.read_text(encoding="utf-8")
    try:
        cur = yaml.safe_load(old) or {}
    except yaml.YAMLError:
        return 422, {"error": f"{pid}/pack.yaml isn't valid YAML, so fix it in an editor first."}
    v = {k: " ".join(str(data.get(k) or "").split()) for k in PACK_KEYS}
    v["places"] = v["places"].lower() or "optional"
    problems = [f"The pack needs a {k}" for k in PACK_LIMITS if not v[k]]
    problems += [f"The {k} is {len(v[k])} characters; keep it to {n}" for k, n in PACK_LIMITS.items() if len(v[k]) > n]
    if v["places"] not in lib.PLACES:
        problems.append(f"Places should be one of {', '.join(lib.PLACES)}")
    icon_dir = Path(root) / "icons" / "packs"
    if icon_dir.is_dir() and not (icon_dir / f"{v['icon']}.svg").exists():
        problems.append("Pick an icon from the list")
    if problems:
        return 422, {"error": ". ".join(problems) + "."}
    text = old
    effective = lib.places_rule(pid, cur)        # what the pack does today, written down or not
    for k in PACK_KEYS:
        if str(cur.get(k) or "") == v[k] or (k == "places" and "places" not in cur and v[k] == effective):
            continue
        if not v[k] and k == "icon":
            text = _replace_key(text, k, "")
            continue
        extra = "   # required | optional | none: whether missions need a real place (SCHEMA.md)" if k == "places" else ""
        text = _replace_key(text, k, f"{k}: {scalar(v[k])}{extra}")
    if text == old:
        return 200, {"unchanged": True, "diff": []}
    if (yaml.safe_load(text) or {}).get("about") != cur.get("about"):
        return 500, {"error": "That change would have touched the pack's about text, so nothing was saved."}
    rel = f"{pid}/pack.yaml"
    mine = [p for p in _check_copy(missions, {rel: text}, root) if p.startswith(f"{pid}/")]
    was = [p for p in lib.check_catalog(missions) if p.startswith(f"{pid}/")]
    new = [p for p in mine if p not in was]
    result = {"diff": _diff(old, text, rel), "problems": new}
    if new:
        return 422, {**result, "error": "Not saved: with this change some of the pack's missions would fail the checks."}
    if not dry:
        path.write_text(text, encoding="utf-8")
        result["ok"] = True
    return 200, result


# ---------- bulk edit ----------

ACTIONS = {
    "add_themes": "Add themes", "remove_themes": "Remove themes",
    "draft": "Make drafts (hide from the site)", "checked_today": "Mark checked today (and publish drafts)",
}


def _apply(action, data, value, today):
    data = dict(data)
    if action == "add_themes":
        have = list(data.get("themes") or [])
        data["themes"] = [t for t in lib.THEMES if t in set(have) | set(value)]   # list order, no repeats
    elif action == "remove_themes":
        left = [t for t in (data.get("themes") or []) if t not in value]
        if left:
            data["themes"] = left
        else:
            data.pop("themes", None)
    elif action == "draft":
        data["draft"] = True
    elif action == "checked_today":
        data.pop("draft", None)
        data["checked"] = today
    return data


def bulk(root, missions, body):
    """(code, result). Every mission is changed and checked on a copy first; nothing is written unless
    every one of them passes and the request isn't a dry run."""
    action, value = body.get("action"), body.get("value") or []
    ids = body.get("missions") or []
    if action not in ACTIONS:
        return 400, {"error": "Pick what to change."}
    if action in ("add_themes", "remove_themes"):
        value = [t for t in value if t in lib.THEMES]
        if not value:
            return 400, {"error": "Pick at least one theme."}
    if not ids or len(ids) > 500:
        return 400, {"error": "Select between 1 and 500 missions."}
    today = datetime.date.today()
    changes, items = {}, []
    for ref in ids:
        pack, _, mid = str(ref).partition("/")
        path = Path(missions) / pack / f"{mid}.yaml"
        if not (lib.ID_RE.match(pack) and lib.ID_RE.match(mid) and path.exists()):
            return 404, {"error": f"No mission at {ref}."}
        old = path.read_text(encoding="utf-8")
        data = yaml.safe_load(old) or {}
        new_data = _apply(action, data, value, today)
        if new_data == data:
            items.append({"file": f"{pack}/{mid}.yaml", "unchanged": True})
            continue
        text, lost = dump_mission(new_data, old)
        changes[f"{pack}/{mid}.yaml"] = text
        items.append({"file": f"{pack}/{mid}.yaml", "diff": _diff(old, text, f"{pack}/{mid}.yaml"), "lost": lost,
                      "version": hashlib.sha256(old.encode()).hexdigest()[:16]})
    if not changes:
        return 200, {"items": items, "problems": [], "changed": 0}
    before = set(lib.check_catalog(missions))
    problems = [p for p in _check_copy(missions, changes, root) if p not in before and p.split(": ")[0] in changes]
    result = {"items": items, "problems": problems, "changed": len(changes), "action": ACTIONS[action]}
    if problems:
        return 422, {**result, "error": "Nothing saved: some of these missions would fail the checks."}
    lost = [i for i in items if i.get("lost")]
    if lost and not body.get("dropComments"):
        result["needsCommentOk"] = True
    if body.get("dry", True) or result.get("needsCommentOk"):
        return 200, result
    reviewed = body.get("versions") or {}     # what each file was when the person looked at the changes
    for rel in changes:
        now = next(i["version"] for i in items if i["file"] == rel)
        if reviewed.get(rel) != now:          # changed in an editor since the review: refuse them all
            return 409, {"error": f"{rel} changed on disk since you reviewed this. Nothing was saved; review again."}
    for rel, text in changes.items():
        path = Path(missions) / rel
        tmp = path.with_name(f".{path.stem}.yaml.tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    result["ok"] = True
    return 200, result


# ---------- ideas (kept out of git) ----------

def ensure_ignored(root, name):
    """Adds `name` to the repo's .gitignore when it isn't there yet. Returns True when it added the line."""
    gi = Path(root) / ".gitignore"
    text = gi.read_text(encoding="utf-8") if gi.exists() else ""
    if any(l.strip() in (name, f"/{name}", f"{name}/", f"/{name}/") for l in text.splitlines()):
        return False
    gi.write_text(text + ("" if not text or text.endswith("\n") else "\n")
                  + f"# kept on this computer only (the AmbleBee mission manager)\n{name}\n", encoding="utf-8")
    return True


def load_ideas(root):
    f = Path(root) / IDEAS_FILE
    if not f.exists():
        return []
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or []
    except yaml.YAMLError:
        raise ValueError(f"{IDEAS_FILE} isn't valid YAML any more; fix it in an editor (nothing was changed).")
    return [i for i in data if isinstance(i, dict) and str(i.get("text") or "").strip()] if isinstance(data, list) else []


def save_ideas(root, ideas):
    clean = []
    for i in ideas if isinstance(ideas, list) else []:
        text = " ".join(str((i or {}).get("text") or "").split())[:300]
        if not text:
            continue
        item = {"text": text, "added": str(i.get("added") or datetime.date.today().isoformat())[:10]}
        pack = str(i.get("pack") or "")
        if lib.ID_RE.match(pack):
            item["pack"] = pack
        if i.get("done"):
            item["done"] = True
        clean.append(item)
    added = ensure_ignored(root, IDEAS_FILE)
    head = ("# Mission ideas: a scratch list from the mission manager's Ideas box.\n"
            "# Kept on this computer only (it's in .gitignore), so jot anything.\n")
    body = yaml.safe_dump(clean, sort_keys=False, allow_unicode=True, width=1000) if clean else "[]\n"
    (Path(root) / IDEAS_FILE).write_text(head + body, encoding="utf-8")
    return clean, added


# ---------- release a pack ----------

FIXED_TIME = (2026, 1, 1, 0, 0, 0)   # every file in the zip gets this date, so the same pack always zips the same


def release(root, missions, pack):
    """(code, result). Zips pack.yaml and the pack's live missions (drafts stay home) into releases/, plus a
    release.json naming the source, pack, date and count. The zip's SHA-256 is what a community listing pins."""
    folder = Path(missions) / pack
    if not lib.ID_RE.match(str(pack)) or not (folder / "pack.yaml").exists():
        return 404, {"error": f"No pack called {pack}."}
    problems = [p for p in lib.check_catalog(missions) if p.startswith(f"{pack}/")]
    if problems:
        return 422, {"error": "Fix this pack's problems first (Scan for problems lists them).", "problems": problems}
    info, packs, all_missions = lib.load_catalog(missions)
    live = sorted((m for m in all_missions if m["pack"] == pack and not m.get("draft")), key=lambda m: m["id"])
    if not live:
        return 422, {"error": "This pack has no live missions yet, so there's nothing to release."}
    source = info.get("source_id", "local")
    day = datetime.date.today().isoformat()
    manifest = {"source_id": source, "source_name": info.get("name"), "author": info.get("author"), "pack": pack,
                "pack_name": packs[pack].get("name", pack), "released": day, "missions": len(live),
                "schema_version": info.get("schema_version", 1), "checker_version": lib.CHECKER_VERSION}
    files = [(f"{pack}/pack.yaml", (folder / "pack.yaml").read_bytes())]
    files += [(f"{pack}/{m['id']}.yaml", Path(m["file"]).read_bytes()) for m in live]
    files.append((f"{pack}/release.json", (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")))
    out_dir = Path(root) / RELEASES
    out_dir.mkdir(exist_ok=True)
    ensure_ignored(root, f"{RELEASES}/")
    name = f"{source}-{pack}-{day}.zip"
    tmp = out_dir / f".{name}.tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for arc, raw in sorted(files):
            zi = zipfile.ZipInfo(arc, FIXED_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, raw)
    os.replace(tmp, out_dir / name)
    data = (out_dir / name).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    (out_dir / f"{name}.sha256").write_text(f"{sha}  {name}\n", encoding="utf-8")
    return 200, {"ok": True, "name": name, "path": str(out_dir / name), "sha256": sha, "bytes": len(data),
                 "missions": len(live), "drafts": sum(1 for m in all_missions if m["pack"] == pack and m.get("draft"))}


# ---------- show in the file browser ----------

def reveal(path):
    """Opens the computer's file browser at `path` (selecting the file where the system can). Returns (ok, note)."""
    path = Path(path)
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        elif os.name == "nt":
            subprocess.Popen(["explorer", f"/select,{path}"])
        else:
            target = path.parent if path.is_file() else path
            for cmd in (["xdg-open", str(target)], ["gio", "open", str(target)]):
                if shutil.which(cmd[0]):
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    break
            else:
                return False, "No file browser could be opened from here (no xdg-open)."
        return True, "Opened on the computer running the manager."
    except OSError as e:
        return False, f"Couldn't open the file browser ({e})."


# ---------- possible duplicates ----------

SAME_SPOT_FILE = "same-spot-ok.yaml"     # in missions/, so it travels with the repo
NEAR_M = 100                             # two pins closer than this are probably the same spot
NAME_ALIKE = 0.88                        # titles this similar (0-1) are probably the same mission


def _norm(s):
    import re as _re
    s = str(s or "").lower().replace("&", "and")
    s = _re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(w for w in s.split() if w not in ("the", "a", "an", "at", "of", "in"))


def _meters(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def same_spot_ok(missions):
    """Pairs marked "different on purpose", as frozensets of mission ids."""
    f = Path(missions) / SAME_SPOT_FILE
    if not f.exists():
        return set()
    try:
        data = yaml.safe_load(f.read_text(encoding="utf-8")) or []
    except yaml.YAMLError:
        return set()
    return {frozenset(map(str, p)) for p in data if isinstance(p, list) and len(p) == 2}


def duplicates(missions):
    """[{a, b, why}] for missions that look like the same thing: pins within NEAR_M, the same place name,
    or near-identical titles. Pairs marked different on purpose are left out."""
    import difflib
    _, _, ms = lib.load_catalog(missions)
    ok = same_spot_ok(missions)
    rows = []
    for m in ms:
        place = m.get("place") or {}
        c = place.get("coords")
        n = _norm(m.get("name"))
        rows.append((m["id"], n, _norm(place.get("name")),
                     c if isinstance(c, list) and len(c) == 2 and all(isinstance(v, (int, float)) for v in c) else None,
                     len(n), set(n.split())))
    out = []
    for i, (ia, na, pa, ca, la, wa) in enumerate(rows):
        for ib, nb, pb, cb, lb, wb in rows[i + 1:]:
            if frozenset((ia, ib)) in ok:
                continue
            why = None
            if ca and cb:
                d = _meters(ca, cb)
                if d <= NEAR_M:
                    why = f"pins {round(d)} m apart"
            if not why and pa and pa == pb:
                why = "same place name"
            # titles: only worth comparing when they share a word and their lengths could reach NAME_ALIKE
            if not why and na and nb and wa & wb and min(la, lb) / max(la, lb) >= NAME_ALIKE / (2 - NAME_ALIKE):
                sm = difflib.SequenceMatcher(None, na, nb)
                if sm.real_quick_ratio() >= NAME_ALIKE and sm.quick_ratio() >= NAME_ALIKE and sm.ratio() >= NAME_ALIKE:
                    why = "nearly the same title"
            if why:
                out.append({"a": ia, "b": ib, "why": why})
    return out


def mark_same_spot_ok(missions, a, b):
    """Records that missions a and b are different on purpose (both must exist)."""
    _, _, ms = lib.load_catalog(missions)
    ids = {m["id"] for m in ms}
    if a == b or a not in ids or b not in ids:
        raise ValueError("Pick two different missions that exist.")
    pairs = sorted(sorted(p) for p in same_spot_ok(missions) | {frozenset((a, b))})
    head = ("# Missions that share a spot (or a name) on purpose: different goals at the same place.\n"
            "# The mission manager's duplicate finder skips these pairs. Its \"Different on purpose\" button adds them.\n")
    (Path(missions) / SAME_SPOT_FILE).write_text(
        head + "".join(f"- [{x}, {y}]\n" for x, y in pairs), encoding="utf-8")
    return len(pairs)
