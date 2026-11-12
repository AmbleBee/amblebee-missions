"""AmbleBee Mission Management: start a pack repo from nothing, see how balanced each pack is, and write,
check and publish missions in the browser.

    python tools/mission_management                     # the repo this folder is in, or the folder you're in
    python tools/mission_management --repo ~/my-packs   # any folder: an existing pack repo, or an empty one

Then open the link it prints. Ctrl+C stops it.

Zero to hero
  - Point it at an empty folder (or a pack repo with pieces missing) and it walks you through setup: it adds
    only what's missing (catalog.yaml, the field reference, a template, the checker and a GitHub check that
    runs on every push) and never overwrites a file.
  - "New pack" makes a pack folder and its pack.yaml: a state, a city, or a theme like Oregon Waterfalls.
  - Settings: what counts as balanced lives in scoring.yaml next to the manager (made from
    scoring.default.yaml on first run). It's yours, git ignores it, and each pack can have its own exceptions.
  - "Scan for problems" runs every check the build would, over the whole repo.

What it does
  - Dashboard: indoor/outdoor, cheap/pricier, date/adventure and theme coverage for every pack,
    a gap finder for the packs furthest out of balance, and every mission with its dates.
  - Editing: every field of a mission in a form, or the file itself in YAML mode (for comments and anything
    the form doesn't cover). Every save shows you exactly which lines will change first, and a change that
    would fail tools/check_missions.py isn't saved; you see why instead.
  - Needs attention: drafts, pins still to verify, missions not checked in six months, expired cautions,
    missing themes or "About this place", fields written twice, and anything failing a check.
  - One-click publish: marks a draft as checked today and publishes it, once the checks pass.
  - Saving writes the YAML file in missions/ directly. Fields you didn't touch keep their exact lines
    (comments included), so `git diff` shows only what you changed. Commit and push as usual.

Safety
  - Anyone on your network could reach the port, so every link carries a random key that changes
    each run. Without it the page shows nothing and nothing can be saved.
  - On a server (AmbleBee Intake runs it inside its admin panel), these settings come from the environment:
    AMBLE_BIND (address to listen on), AMBLE_PORT (one fixed port), AMBLE_LOCK (a key every request must carry;
    the page can't change or remove it, and Lock and Stop are hidden).
  - If a file changed on disk after you opened it (say you edited it in VSCodium), the save is refused
    so neither change gets lost. Reload the mission and redo the edit.
"""
import datetime
import difflib
import hashlib
import http.server
import ipaddress
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))            # everything the manager needs sits next to this file

import yaml  # noqa: E402

import amble_checks as lib  # noqa: E402
import coverage  # noqa: E402
import extras  # noqa: E402
import linkcheck  # noqa: E402
import scoring  # noqa: E402
import theme_hints  # noqa: E402
import setup_repo  # noqa: E402
from writer import chunks, comments_in, dump_mission, same_data  # noqa: E402

ROOT = MISSIONS = None    # set by use_repo() at startup


def use_repo(path):
    global ROOT, MISSIONS
    ROOT = Path(path).expanduser().resolve()
    MISSIONS = ROOT / "missions"
    linkcheck.OK_FILE = MISSIONS / "links-ok.yaml"


# Files the manager writes that only mean something on this computer, so they stay out of git.
PRIVATE = ("missions/links-ok.yaml", ".mission-edits/")


def default_repo():
    """The repo to open when none is named: the one the manager sits in (tools/mission_management/ in a pack
    repo), else the folder you started it from."""
    inside = HERE.parent.parent
    if (inside / "missions" / "catalog.yaml").exists():
        return inside
    return Path.cwd()


def ready():
    return (MISSIONS / "catalog.yaml").exists()

PORTS = range(int(os.environ["AMBLE_PORT"]), int(os.environ["AMBLE_PORT"]) + 1) if os.environ.get("AMBLE_PORT") \
    else range(8812, 8822)
BIND = os.environ.get("AMBLE_BIND", "0.0.0.0")
FIXED_KEY = os.environ.get("AMBLE_LOCK", "")   # set by the server it runs on (see Safety above); the page can't change it
LOCK = {"key": FIXED_KEY}  # a temporary key set from the page (Lock); empty means open. Forgotten when the manager stops.
SERVER = None
FOLDED = ("description", "about")

# The theme chips, grouped the way _template.yaml groups them.
THEME_GROUPS = {
    "Outdoors": ["views", "hiking", "walks", "waterfalls", "beach", "lakes-rivers", "mountains", "deserts",
                 "swimming", "boating", "caves", "rocks-fossils", "forests", "parks", "wildlife", "gardens",
                 "stars", "biking", "picnic", "sunsets"],
    "Culture": ["history", "museums", "science", "art", "architecture", "vehicles", "spooky"],
    "Fun": ["food", "drinks", "markets", "movies", "shows", "games", "thrills", "quirky", "holidays", "road-trips"],
    "Feel": ["playful", "romantic", "relaxing", "small-towns", "make-something"],
}


# ---------- reading ----------

def mission_path(pack, mid):
    return MISSIONS / pack / f"{mid}.yaml"


def version_of(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def for_form(data):
    """The file's data as the editor shows it: dates as text, paragraphs separated by a blank line."""
    out = {}
    for k, v in data.items():
        if hasattr(v, "isoformat"):
            v = v.isoformat()[:10]
        elif k in FOLDED and isinstance(v, str):
            v = "\n\n".join(p.strip() for p in v.strip().split("\n"))
        out[k] = v
    return out


def git_changes():
    """Files changed since the last commit (everything git would show you), or None outside a git checkout."""
    try:
        top = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        out = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--untracked-files=all"],
                             capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return None
    if top.returncode or out.returncode:
        return None
    try:
        under = ROOT.relative_to(Path(top.stdout.strip()).resolve()).as_posix()
    except ValueError:
        under = "."
    under = "" if under == "." else under      # "" when the manager's repo is the git repo itself
    files = []
    for line in out.stdout.splitlines():
        st, path = line[:2], line[3:].split(" -> ")[-1].strip('"')
        kind = "new" if "?" in st or "A" in st else "deleted" if "D" in st else "changed"
        rel = path[len(under) + 1:] if under and path.startswith(under + "/") else path
        m = re.fullmatch(r"missions/([a-z0-9][a-z0-9-]*)/([a-z0-9][a-z0-9-]*)\.yaml", rel)
        files.append({"path": path, "kind": kind, **({"pack": m.group(1), "id": m.group(2)} if m and kind != "deleted" else {})})
    return {"files": files}


def dashboard_data():
    if not ready():
        return {"setup": setup_repo.status(ROOT)}
    settings, scoring_note = scoring.load()
    info, rows, note = coverage.load(MISSIONS)
    packs = {pid: p["name"] for pid, p in info.items()}
    return {
        "repo": str(ROOT), "packs": packs, "packInfo": info, "missions": attention(rows, info, settings), "note": note,
        "repair": setup_repo.status(ROOT), "icons": setup_repo.icons(ROOT), "places": list(lib.PLACES),
        "settings": settings, "scoringNote": scoring_note, "dims": scoring.DIMS,
        "rules": {pid: scoring.for_pack(settings, pid) for pid in packs},
        "themeHints": theme_hints.hints(), "bulkActions": extras.ACTIONS,
        "card": card_ready(), "packIcons": pack_icons() if card_ready() else {},
        "source": {k: (lib.load_catalog(MISSIONS)[0] or {}).get(k) for k in ("name", "source_id", "author")},
        "attention": {k: {"label": v[0], "help": v[1]} for k, v in ATTENTION.items()},
        "themes": lib.THEMES, "themeGroups": THEME_GROUPS, "themesMax": lib.THEMES_MAX,
        "minMissions": settings["min_missions"], "git": git_changes(),
        "schema": {
            "allowed": {k: sorted(v) for k, v in lib.ALLOWED.items()},
            "lists": {k: sorted(v) for k, v in lib.LIST_ALLOWED.items()},
            "gear": sorted(lib.GEAR), "rent": ["on-site", "nearby", "no"],
            "limits": {"short": lib.SHORT_MAX, "description": lib.DESCRIPTION_MAX, "about": lib.ABOUT_MAX,
                       "caution": lib.CAUTION_MAX, "credit": lib.CREDIT_MAX, "links": lib.LINKS_MAX,
                       "linkLabel": lib.LINK_LABEL_MAX},
        },
    }


# ---------- draft baselines: what a draft looked like before its first edit ----------
# Saving a draft keeps a copy of the file as it was before that draft's first save, so the editor can show every
# field changed since then in green, across sessions, until the mission goes live (then the copy is deleted).

def baseline_path(pack, mid):
    return ROOT / ".mission-edits" / pack / f"{mid}.yaml"


def keep_baseline(pack, mid, before, after):
    """Called after every save. before: the file's text before the save ("" for a new mission)."""
    f = baseline_path(pack, mid)
    if (yaml.safe_load(after) or {}).get("draft"):
        if not f.exists():
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(before, encoding="utf-8")
            extras.ensure_ignored(ROOT, ".mission-edits/")
    elif f.exists():
        f.unlink()


def prune_baselines():
    """Drops baselines for missions that went live some other way (a bulk publish, an edit in a text editor)."""
    top = ROOT / ".mission-edits"
    if not top.is_dir():
        return
    for f in top.glob("*/*.yaml"):
        m = mission_path(f.parent.name, f.stem)
        try:
            draft = m.exists() and (yaml.load(m.read_text(encoding="utf-8"), Loader=lib._Loader) or {}).get("draft")
        except yaml.YAMLError:
            continue
        if not draft:
            f.unlink()


def read_mission(pack, mid):
    path = mission_path(pack, mid)
    text = path.read_text(encoding="utf-8")
    *_, dups = chunks(text)
    data = yaml.safe_load(text) or {}
    out = {"data": for_form(data), "version": version_of(text), "text": text,
           "comments": comments_in(text.splitlines()), "duplicates": dups,
           "path": str(path.relative_to(ROOT))}
    b = baseline_path(pack, mid)
    if b.exists():
        if not data.get("draft"):
            b.unlink()
        else:
            try:
                before = b.read_text(encoding="utf-8")
                out["baseline"] = {"data": for_form(yaml.safe_load(before) or {}) if before.strip() else None,
                                   "since": datetime.date.fromtimestamp(b.stat().st_mtime).isoformat()}
            except yaml.YAMLError:
                pass
    return out


# ---------- needs attention ----------

ATTENTION = {        # code: (label shown on the dashboard, what it means)
    "fails-check": ("Fails a check", "Something tools/check_missions.py flags; open it to see what"),
    "doubled": ("Field written twice", "YAML only keeps the last copy; delete the one you don't want"),
    "approx-pin": ("Pin to verify", "A note in the file says the pin or address still needs checking"),
    "no-address": ("Draft with no address", "Drafts only (trailheads and viewpoints don't need one, so live missions aren't flagged)"),
    "no-pin": ("No pin yet", "Its pack needs a place for every mission, and this one has no coords"),
    "caution-expired": ("Expired caution", "The caution_until date has passed; delete both caution lines"),
    "stale": ("Checked 6+ months ago", "Worth a fresh look: hours, prices and places change"),
    "no-themes": ("No themes", "Won't show under any of the website's theme chips"),
    "no-about": ("No 'About this place'", "Missions with a place only; the page is thinner without it"),
    "link-broken": ("Broken link", "A website or extra link didn't work the last time links were checked"),
    "link-moved": ("Link moved", "A link now sends people somewhere else; check it still points to the right page"),
    "twin": ("Possible duplicate", "Very close to, or named like, another mission; open it to compare, or mark them different on purpose"),
    "draft": ("Draft", "Waiting to be checked and published"),
}


_checked = {"sig": None, "problems": []}


def catalog_problems():
    """check_catalog() for the whole catalog, rerun only when a mission file changed (it takes a couple of seconds)."""
    sig = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in sorted(MISSIONS.rglob("*.yaml")))
    if sig != _checked["sig"]:
        _checked.update(sig=sig, problems=lib.check_catalog(MISSIONS))
    return _checked["problems"]


_dups = {"sig": None, "pairs": []}


def duplicate_pairs():
    """extras.duplicates(), rerun only when a mission file (or the different-on-purpose list) changed."""
    files = sorted(MISSIONS.rglob("*.yaml"))
    sig = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in files)
    if sig != _dups["sig"]:
        _dups.update(sig=sig, pairs=extras.duplicates(MISSIONS))
    return _dups["pairs"]


_files = {}   # path: ((mtime, size), (data, has doubled fields, has a "pin to verify" note))


def file_facts(path):
    """Reading 600 YAML files takes a few seconds, so each is reread only when it changes."""
    st = path.stat()
    key = (st.st_mtime_ns, st.st_size)
    if path not in _files or _files[path][0] != key:
        text = path.read_text(encoding="utf-8")
        # the same "check the pin" notes the checker blocks on a live mission (the draft line's own note is the Draft badge)
        approx = any(not line.startswith("draft:") for _, line in lib.pin_notes(text))
        _files[path] = (key, (yaml.load(text, Loader=lib._Loader) or {}, bool(lib.duplicate_fields(text)), approx))
    return _files[path][1]


def attention(rows, packs, settings):
    """Adds `issues` (codes from ATTENTION) and, when it fails a check, `problems` to each mission row."""
    by_file = {}
    for p in catalog_problems():
        where, _, msg = p.partition(": ")
        by_file.setdefault(where, []).append(msg or p)
    today = datetime.date.today()
    link_marks = linkcheck.marks()
    twins = {}
    for d in duplicate_pairs():
        twins.setdefault(d["a"], []).append({"id": d["b"], "why": d["why"]})
        twins.setdefault(d["b"], []).append({"id": d["a"], "why": d["why"]})
    for r in rows:
        rel = f"{r['pack']}/{r['id']}.yaml"
        data, doubled, approx = file_facts(MISSIONS / rel)
        rule = (packs.get(r["pack"]) or {}).get("places", "optional")
        issues = []
        if rel in by_file:
            issues.append("fails-check")
            r["problems"] = by_file[rel]
        if doubled:
            issues.append("doubled")
        if approx:
            issues.append("approx-pin")
        if data.get("draft") and data.get("place") and not (data.get("place") or {}).get("address"):
            issues.append("no-address")
        if rule == "required" and not ((data.get("place") or {}).get("coords")):
            issues.append("no-pin")
        until = lib.caution_until_date(data.get("caution_until"))
        if data.get("caution") and until and until < today:
            issues.append("caution-expired")
        checked = lib.caution_until_date(data.get("checked"))
        if not data.get("draft") and checked and (today - checked).days > settings["stale_days"]:
            issues.append("stale")
        if not data.get("themes"):
            issues.append("no-themes")
        if (rule == "required" or data.get("place")) and not data.get("about"):
            issues.append("no-about")
        found = {x["status"] for x in linkcheck.results_for(data, link_marks) if not x.get("manual")}
        if "broken" in found:
            issues.append("link-broken")
        if "moved" in found:
            issues.append("link-moved")
        if r["id"] in twins:
            issues.append("twin")
            r["twins"] = twins[r["id"]]
        if data.get("draft"):
            issues.append("draft")
        r["issues"] = issues
        r["hasPin"] = bool((data.get("place") or {}).get("coords"))
        r["suggestion"] = data.get("suggestion")      # the AmbleBee Intake submission it came from, if any
    return rows


# ---------- saving: work out exactly what would be written, then (only for a save) write it ----------

def _empty(v):
    return v is None or v == "" or v == [] or v == {}


ODD_SPACE = re.compile("[\u00a0\u2007\u202f\t]")         # non-breaking spaces and tabs from copied text
INVISIBLE = re.compile("[\u200b-\u200d\ufeff]")             # zero-width characters


def clean(data, old):
    """Tidy what the form sent: folded paragraphs, no blank fields (unless the file already had one)."""
    out = {}
    for k, v in data.items():
        if isinstance(v, str):
            v = INVISIBLE.sub("", ODD_SPACE.sub(" ", v.replace("\r\n", "\n").replace("\r", "\n")))
        if k in FOLDED and isinstance(v, str):
            paras = [" ".join(p.split()) for p in re.split(r"\n\s*\n", v.strip()) if p.strip()]
            v = "\n".join(paras)
        elif isinstance(v, str):
            v = " ".join(v.split())          # one-line fields stay on one line, however the text got in
        elif isinstance(v, list):
            v = [x.strip() if isinstance(x, str) else x for x in v]
            v = [x for x in v if not _empty(x)]
        elif isinstance(v, dict):
            v = clean(v, old.get(k) if isinstance(old.get(k), dict) else {})
        if k == "links" and isinstance(v, list):
            v = [l for l in v if isinstance(l, dict) and (l.get("label") or l.get("url"))]
        if k == "gear" and isinstance(v, list):
            v = [g for g in v if isinstance(g, dict) and g.get("item")]
        if _empty(v):
            if k in old and _empty(old[k]):
                out[k] = old[k]      # an empty line already in the file (like `credit:`) stays as it was
            continue
        out[k] = v
    return out


def validate(pack, mid, text):
    """Problems check_missions.py would report for this mission, checked against a copy of the catalog."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        shutil.copytree(MISSIONS, tmp / "missions", ignore=shutil.ignore_patterns(".*"))
        if (ROOT / "icons").exists():
            (tmp / "icons").symlink_to(ROOT / "icons")
        (tmp / "missions" / pack / f"{mid}.yaml").write_text(text, encoding="utf-8")
        problems = lib.check_catalog(tmp / "missions")
    mine = f"{pack}/{mid}.yaml"
    return [p.replace(f"{mine}: ", "", 1) for p in problems if mine in p]


def yaml_error(e):
    """(line, message) for a YAML mistake, in plain words."""
    mark = getattr(e, "problem_mark", None)
    line = mark.line + 1 if mark else None
    what = (getattr(e, "problem", None) or str(e)).strip()
    hints = {"mapping values are not allowed here": "a ':' where YAML doesn't expect one (wrap the text in quotes)",
             "found character '\\t' that cannot start any token": "a tab; YAML needs spaces for indenting"}
    return line, hints.get(what, what)


def parse_yaml(text):
    """(data, error): the YAML editor's text read as a mission, or why it can't be."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        line, what = yaml_error(e)
        return None, {"error": "That isn't valid YAML yet.", "line": line,
                      "problems": [f"Line {line}: {what}" if line else what]}
    if not isinstance(data, dict):
        return None, {"error": "A mission file is a list of fields, like `name: ...` and `mode: date`.", "line": 1,
                      "problems": ["The text doesn't start with fields."]}
    return data, None


def prepare(body):
    """(status, result, path, text). result has the diff, any problems, and comments a form save would drop.
    text is what a save would write (None when there's nothing to write)."""
    pack, mid, is_new = body.get("pack"), body.get("id"), bool(body.get("isNew"))
    _, packs, _ = lib.load_catalog(MISSIONS)
    if pack not in packs or pack == "general":
        return 400, {"error": f"No pack folder named '{pack}'."}, None, None
    if not isinstance(mid, str) or not lib.ID_RE.match(mid):
        return 400, {"error": "The file name (id) can only use lowercase letters, numbers and dashes."}, None, None
    path = mission_path(pack, mid)
    if is_new:
        clash = list(MISSIONS.glob(f"*/{mid}.yaml"))
        if clash:
            return 409, {"error": f"There's already a mission called {mid} (in {clash[0].parent.name}/). "
                                  f"Ids are unique across all packs; pick another file name."}, None, None
        original, old = "", {}
    else:
        if not path.exists():
            return 404, {"error": f"{path.relative_to(ROOT)} doesn't exist any more."}, None, None
        original = path.read_text(encoding="utf-8")
        if version_of(original) != body.get("version"):
            return 409, {"error": "This file changed on disk since you opened it (maybe in your editor). "
                                  "Nothing was saved. Reopen the mission to get the latest version, then redo your edit.",
                         "stale": True}, None, None
        old = yaml.safe_load(original) or {}

    lost = []
    if "yaml" in body:                       # YAML mode: saved exactly as typed, comments and all
        text = str(body["yaml"]).replace("\r\n", "\n").rstrip("\n") + "\n"
        _, err = parse_yaml(text)
        if err:
            return 200, {**err, "diff": [], "lost": [], "text": text}, path, None
    else:                                    # form mode: only the changed lines are rewritten
        base = body.get("base") or original  # the YAML editor's text, when the form was switched back from it
        if base != original and parse_yaml(base)[1]:
            base = original
        data = clean(body.get("data") or {}, old)
        remove = [str(c) for c in (body.get("removeComments") or []) if isinstance(c, str)]
        if base and "draft" in (yaml.safe_load(base) or {}) and "draft" not in data:
            # publishing: the note on the draft line ("delete this line once it's checked") is meant to go
            remove += [c for c in comments_in(chunks(base)[1].get("draft", [])) if c not in remove]
        try:
            text, removing = dump_mission(data, base or None, remove)   # every other note is kept
        except ValueError as e:
            return 500, {"error": str(e)}, None, None
    if not is_new and text.rstrip("\n") == original.rstrip("\n"):   # only a missing line break at the end
        return 200, {"unchanged": True, "diff": [], "lost": [], "problems": [], "text": text}, path, None
    diff = list(difflib.unified_diff(original.splitlines(), text.splitlines(),
                                     "before" if original else "new file", "after", lineterm="", n=2))[2:]
    problems = validate(pack, mid, text) if body.get("check", True) else []   # switching to YAML just needs the text
    return 200, {"diff": diff, "lost": lost, "removing": removing if "yaml" not in body else [],
                 "problems": problems, "text": text}, path, text


def save(body):
    code, out, path, text = prepare(body)
    if code != 200 or text is None:
        if out.get("unchanged"):
            return 200, {"ok": True, "unchanged": True, "version": version_of(out["text"])}
        if out.get("problems"):
            return 422, {**out, "error": out.get("error") or "Not saved: this would fail the mission checks."}
        return code, out
    if out["problems"]:
        return 422, {**out, "error": "Not saved: this would fail the mission checks."}
    if out["lost"] and not body.get("dropComments"):
        return 409, {**out, "error": "Saving would remove comments from lines you changed."}
    before = path.read_text(encoding="utf-8") if path.exists() else ""
    tmp = path.with_name(f".{path.stem}.yaml.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    try:
        keep_baseline(body.get("pack"), body.get("id"), before, text)
    except OSError:
        pass     # only the green marks depend on it
    return 200, {"ok": True, "version": version_of(text), "path": str(path.relative_to(ROOT))}


# ---------- scan for problems: everything the build checks, over the whole repo ----------

def _split(problem):
    where, sep, msg = problem.partition(": ")
    return (where, msg) if sep and where.endswith(".yaml") else ("", problem)


def number_gaps(missions):
    """Skipped numbers per pack (a gap can be on purpose, so these are notes, never errors)."""
    out = []
    by_pack = {}
    for m in missions:
        if isinstance(m.get("number"), int):
            by_pack.setdefault(m["pack"], set()).add(m["number"])
    for pack, nums in sorted(by_pack.items()):
        missing = sorted(set(range(1, max(nums) + 1)) - nums)
        if missing:
            shown = ", ".join(map(str, missing[:12])) + (" …" if len(missing) > 12 else "")
            what = f"number {shown} is" if len(missing) == 1 else f"numbers {shown} are"
            out.append(f"{pack}: {what} unused (fine if those missions were removed; numbers are never reused)")
    return out


def scan():
    """{errors: [{file, msg}], notes: [...], extra: [{label, ok, lines}], ok}. Errors are what would stop the build."""
    _checked["sig"] = None                                   # always a fresh run
    errors = [dict(zip(("file", "msg"), _split(p))) for p in catalog_problems()]
    notes = []
    try:
        _, packs, missions = lib.load_catalog(MISSIONS)
    except ValueError as e:
        return {"errors": errors or [{"file": "", "msg": str(e)}], "notes": [], "extra": [], "ok": False}
    for m, d in lib.expired_cautions(missions):
        notes.append({"file": f"{m['pack']}/{m['id']}.yaml", "msg": f"caution ended {d.isoformat()}; delete the caution lines"})
    notes += [{"file": "", "msg": n} for n in number_gaps(missions)]
    for pid, pk in packs.items():
        if pid == "general":
            continue
        gaps = [k for k in ("name", "region", "description") if not str(pk.get(k) or "").strip()]
        if gaps:
            errors.append({"file": f"{pid}/pack.yaml", "msg": f"missing {', '.join(gaps)}"})
    ids = {m["id"]: m for m in missions}
    for d in duplicate_pairs():
        a, b = ids.get(d["a"]), ids.get(d["b"])
        if a and b:
            notes.append({"file": f"{a['pack']}/{a['id']}.yaml", "twin": f"{b['pack']}/{b['id']}",
                          "msg": f"possible duplicate of {b['pack']}/{b['id']}.yaml ({d['why']})"})
    ck = setup_repo.checker_info(ROOT)
    if ck["outdated"]:
        notes.append({"file": "", "msg": f"This repo's checker (tools/amble_checks.py) is version {ck['repo']}; the manager's is "
                                         f"{ck['manager']}. Update it from the setup notice so GitHub checks the same rules."})
    extra = []
    pins = ROOT / "tools" / "check_pins.py"          # a repo's own extra checks, when it has them (AmbleBee's map pins)
    if pins.exists() and (ROOT / "data" / "cities.json").exists():
        try:
            out = subprocess.run([sys.executable, str(pins)], cwd=ROOT, capture_output=True, text=True, timeout=180)
            lines = [l for l in (out.stdout + out.stderr).splitlines() if l.strip()]
            extra.append({"label": "Map pins (tools/check_pins.py)", "ok": out.returncode == 0, "lines": lines[-60:]})
        except (OSError, subprocess.SubprocessError) as e:
            extra.append({"label": "Map pins (tools/check_pins.py)", "ok": False, "lines": [f"Couldn't run it: {e}"]})
    return {"errors": errors, "notes": notes, "extra": extra, "missions": len(missions),
            "ok": not errors and all(x["ok"] for x in extra)}


# ---------- the website's own mission card, for previews ----------

CARD_FILES = ("style.css", "js/core.js", "js/ticket.js")


def card_ready():
    return all((ROOT / "site" / f).is_file() for f in CARD_FILES)


def pack_icons():
    """{icon name: inner SVG markup}, the same shapes the website's icons.json carries."""
    out = {}
    d = ROOT / "icons" / "packs"
    for f in sorted(d.glob("*.svg")) if d.is_dir() else []:
        m = re.search(r"<svg[^>]*>(.*)</svg>", f.read_text(encoding="utf-8"), re.S)
        if m:
            inner = re.sub(r"<(metadata|title|desc)\b.*?</\1>", "", m.group(1), flags=re.S)
            out[f.stem] = " ".join(inner.split())
    return out


def card_frame():
    """A tiny page that loads the website's stylesheet, core.js and ticket.js, then draws whatever mission the
    editor sends it with the website's own ticket(). The Hive shows this same card, so the preview can't drift."""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="site/fonts/fonts.css"><link rel="stylesheet" href="site/style.css">
<style>html,body{{margin:0}} body{{padding:12px 10px 14px;border-radius:14px}} .ticket{{margin:0 !important}}
a{{pointer-events:none}} .full-page,.report{{opacity:.6}}</style>
<script src="site/js/core.js"></script><script src="site/js/ticket.js"></script></head>
<body><div id="card"></div><script>
addEventListener("message", (e) => {{
  if (e.origin !== location.origin || !e.data || e.data.type !== "card") return;
  const {{ mission, packs, icons }} = e.data;
  S.packs = packs; S.packById = Object.fromEntries(packs.map((p) => [p.id, p])); S.icons = icons;
  let out;
  try {{ out = ticket(mission, {{ heading: "h2" }}); }}
  catch (err) {{ out = document.createElement("p"); out.textContent = "The website's card couldn't draw this mission: " + err.message; }}
  document.getElementById("card").replaceChildren(out);
  requestAnimationFrame(() => parent.postMessage({{ type: "card-height", h: document.documentElement.scrollHeight }}, location.origin));
}});
parent.postMessage({{ type: "card-ready" }}, location.origin);
</script></body></html>"""


# ---------- serving ----------

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        try:
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass     # the browser stopped waiting (a reload or a closed tab); nothing to do

    def _route(self):
        """The path without any prefix a proxy added (code-server serves this at /proxy/<port>/ or
        /absproxy/<port>/), so the manager works both directly and through an editor's port proxy."""
        path = urllib.parse.urlparse(self.path).path
        found = [at for at in (path.find(m) for m in ("/api/", "/fonts/", "/site/", "/card-frame")) if at >= 0]
        if found:                       # the earliest marker wins: /site/fonts/... is a site file, not /fonts/
            return path[min(found):]
        return "/" if path.endswith("/") else path

    def _authed(self, q=None):
        """Open unless someone set a temporary key with the page's Lock button."""
        if not LOCK["key"]:
            return True
        got = self.headers.get("X-Amble-Key", "") or ((q or {}).get("key") or [""])[0]
        return secrets.compare_digest(got.encode("utf-8"), LOCK["key"].encode("utf-8"))

    def _locked_out(self):
        return self._send(403, {"error": "This manager is locked. Enter the key that was set on it.", "locked": True})

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        path = self._route()
        if path == "/":
            return self._send(200, (HERE / "app.html").read_bytes(), "text/html; charset=utf-8")
        if path == "/card-frame":          # the website's own mission card, for the editor's preview
            if not card_ready():
                return self._send(404, {"error": "This repo has no site/js/ticket.js."})
            return self._send(200, card_frame().encode("utf-8"), "text/html; charset=utf-8")
        if path.startswith("/site/"):         # the few public website files that page needs
            rel = path[len("/site/"):]
            if rel in CARD_FILES or (rel.startswith("fonts/") and rel.endswith((".woff2", ".css")) and "/" not in rel[6:]):
                f = ROOT / "site" / rel
                if f.is_file():
                    ctype = {".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2"}[f.suffix]
                    return self._send(200, f.read_bytes(), f"{ctype}; charset=utf-8" if f.suffix != ".woff2" else ctype)
            return self._send(404, {"error": "Not found"})
        if path.startswith("/fonts/"):
            name = Path(path).name
            f = next((d / name for d in (HERE / "fonts", ROOT / "site" / "fonts") if (d / name).exists()), HERE / name)
            if f.suffix == ".woff2" and f.exists():
                return self._send(200, f.read_bytes(), "font/woff2")
            return self._send(404, {"error": "no such font"})
        if path == "/api/lock":
            return self._send(200, {"locked": bool(LOCK["key"]), "ok": self._authed(), "managed": bool(FIXED_KEY)})
        if not self._authed(q if path == "/api/release-file" else None):    # a download link carries the key itself
            return self._locked_out()
        try:
            if path == "/api/data":
                return self._send(200, dashboard_data())
            if path == "/api/scoring":
                settings, note = scoring.load()
                return self._send(200, {"settings": settings, "defaults": scoring.defaults(), "note": note,
                                        "file": str(scoring.FILE)})
            if path == "/api/ideas":
                if not ready():
                    return self._send(409, {"error": "Set up the repo first."})
                return self._send(200, {"ideas": extras.load_ideas(ROOT), "file": extras.IDEAS_FILE})
            if path == "/api/release-file":
                name = Path((q.get("name") or [""])[0]).name
                f = ROOT / extras.RELEASES / name
                if not name.endswith(".zip") or not f.is_file():
                    return self._send(404, {"error": "No such release."})
                raw = f.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{name}"')
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            if path == "/api/links/status":
                return self._send(200, linkcheck.RUN.status())
            if path == "/api/scan":
                if not ready():
                    return self._send(409, {"error": "Set up the repo first."})
                return self._send(200, scan())
            if path == "/api/mission":
                pack, mid = (q.get("pack") or [""])[0], (q.get("id") or [""])[0]
                if not ready() or not lib.ID_RE.match(mid) or not lib.ID_RE.match(pack) or not mission_path(pack, mid).exists():
                    return self._send(404, {"error": "No such mission."})
                return self._send(200, read_mission(pack, mid))
        except ValueError as e:      # a mission file that won't load
            return self._send(500, {"error": str(e)})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        if not self._authed():
            return self._locked_out()
        path = self._route()
        if FIXED_KEY and path in ("/api/stop", "/api/unlock", "/api/lock"):
            return self._send(403, {"error": "This manager is run by a server, which sets its key and keeps it running."})
        if path == "/api/stop":                 # the page's Stop button: answer, then shut down
            self._send(200, {"ok": True})
            threading.Thread(target=SERVER.shutdown, daemon=True).start()
            return
        if path == "/api/unlock":
            LOCK["key"] = ""
            return self._send(200, {"ok": True, "locked": False})
        if path not in ("/api/mission", "/api/preview", "/api/parse", "/api/setup", "/api/checker", "/api/pack",
                        "/api/scoring", "/api/scoring/reset", "/api/pack/edit", "/api/bulk", "/api/ideas",
                        "/api/release", "/api/reveal", "/api/same-spot", "/api/links",
                        "/api/links/start", "/api/link", "/api/link/mark", "/api/lock") or \
                "application/json" not in self.headers.get("Content-Type", ""):
            return self._send(404, {"error": "Not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if path == "/api/lock":             # set (or change) the temporary key
                key = str(body.get("key") or "").strip()
                if len(key) < 4:
                    return self._send(422, {"error": "Use at least 4 characters."})
                LOCK["key"] = key
                return self._send(200, {"ok": True, "locked": True})
            if path == "/api/setup":            # create whatever the repo is missing (never overwrites)
                try:
                    created = setup_repo.apply(ROOT, body)
                    _checked["sig"] = None
                    code, out = 200, {"ok": True, "created": created}
                except ValueError as e:
                    code, out = 422, {"error": str(e)}
                return self._send(code, out)
            if path == "/api/checker":
                try:
                    code, out = 200, {"ok": True, "checker": setup_repo.update_checker(ROOT)}
                except ValueError as e:
                    code, out = 409, {"error": str(e)}
                return self._send(code, out)
            if path == "/api/pack":
                try:
                    code, out = 200, {"ok": True, "id": setup_repo.create_pack(ROOT, body)}
                except ValueError as e:
                    code, out = 422, {"error": str(e)}
                return self._send(code, out)
            if path == "/api/scoring":
                settings, notes = scoring.save(body.get("settings"))
                return self._send(200, {"ok": True, "settings": settings, "notes": notes})
            if path == "/api/scoring/reset":
                settings, note = scoring.reset()
                return self._send(200, {"ok": True, "settings": settings, "note": note})
            if not ready():
                return self._send(409, {"error": "Set up the repo first."})
            if path == "/api/pack/edit":        # dry run shows the change; a real one writes pack.yaml
                code, out = extras.edit_pack(ROOT, MISSIONS, body, dry=body.get("dry", True))
                if out.get("ok"):
                    _checked["sig"] = None
                return self._send(code, out)
            if path == "/api/bulk":
                code, out = extras.bulk(ROOT, MISSIONS, body)
                if out.get("ok"):
                    _checked["sig"] = None
                return self._send(code, out)
            if path == "/api/ideas":
                try:
                    ideas, added = extras.save_ideas(ROOT, body.get("ideas"))
                    return self._send(200, {"ok": True, "ideas": ideas, "gitignoreAdded": added})
                except ValueError as e:
                    return self._send(422, {"error": str(e)})
            if path == "/api/links":           # one mission's links, checked now (the editor asks when it opens)
                pack, mid = str(body.get("pack") or ""), str(body.get("id") or "")
                f = mission_path(pack, mid) if lib.ID_RE.match(pack) and lib.ID_RE.match(mid) else None
                if not f or not f.exists():
                    return self._send(404, {"error": "No such mission."})
                data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
                return self._send(200, {"links": linkcheck.check_mission(data, force=bool(body.get("force")))})
            if path == "/api/link":            # one address, checked now (the Check link button beside a field)
                url = str(body.get("url") or "").strip()
                if not url:
                    return self._send(400, {"error": "No link to check."})
                return self._send(200, linkcheck.with_mark(linkcheck.check_url(url, force=True)))
            if path == "/api/link/mark":       # "Mark as good" / "Unmark" for a link the checker can't confirm
                url = str(body.get("url") or "").strip()
                if not url.startswith(("http://", "https://")):
                    return self._send(400, {"error": "That isn't a web address."})
                mark = linkcheck.set_mark(url, bool(body.get("good")))
                extras.ensure_ignored(ROOT, "missions/links-ok.yaml")     # your own marks; not for GitHub
                return self._send(200, {"ok": True, "manual": mark})
            if path == "/api/links/start":     # every mission's links, in the background
                _, _, ms = lib.load_catalog(MISSIONS)
                started = linkcheck.RUN.start(ms)
                return self._send(200, {"started": started, **linkcheck.RUN.status()})
            if path == "/api/same-spot":       # "different on purpose": stop flagging this pair
                try:
                    n = extras.mark_same_spot_ok(MISSIONS, str(body.get("a") or ""), str(body.get("b") or ""))
                    return self._send(200, {"ok": True, "pairs": n})
                except ValueError as e:
                    return self._send(422, {"error": str(e)})
            if path == "/api/release":
                code, out = extras.release(ROOT, MISSIONS, str(body.get("pack") or ""))
                return self._send(code, out)
            if path == "/api/reveal":           # the file (or releases folder) in this computer's file browser
                rel = str(body.get("file") or "")
                target = (ROOT / extras.RELEASES / Path(rel).name) if body.get("release") else (MISSIONS / rel)
                try:
                    target.resolve().relative_to(ROOT)
                except ValueError:
                    return self._send(400, {"error": "That's outside the repo."})
                if not target.exists():
                    return self._send(404, {"error": f"{rel} doesn't exist."})
                ok, note = extras.reveal(target)
                return self._send(200 if ok else 500, {"ok": ok, "note": note, "path": str(target)} if ok
                                  else {"error": note, "path": str(target)})
            if path == "/api/preview":          # what a save would change, without writing anything
                code, out, _, _ = prepare(body)
            elif path == "/api/parse":          # the YAML editor's text, read back for the form
                data, err = parse_yaml(str(body.get("yaml") or ""))
                code, out = 200, ({"data": for_form(data), "duplicates": [d[0] for d in lib.duplicate_fields(str(body.get("yaml")))],
                                   "comments": comments_in(str(body.get("yaml") or "").splitlines())}
                                  if data is not None else err)   # a typo isn't an HTTP error; the editor shows it
            else:
                code, out = save(body)
        except (ValueError, json.JSONDecodeError) as e:
            code, out = 400, {"error": f"Couldn't read that request ({e})."}
        self._send(code, out)


def route_ip(target):
    """This computer's address on the network that would carry traffic to `target` (nothing is sent)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((target, 1))
            return s.getsockname()[0]
    except OSError:
        return None


def lan_ip():
    return route_ip("10.255.255.255")


def tailscale_links():
    """(Tailscale IP, MagicDNS name) when Tailscale is running here, else (None, None)."""
    ip = route_ip("100.100.100.100")        # Tailscale's own resolver; only routes via Tailscale when it's up
    if not ip or not ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10"):
        return None, None
    name = None
    try:
        out = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=3)
        name = (json.loads(out.stdout).get("Self") or {}).get("DNSName", "").rstrip(".") or None
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return ip, name


def main():
    import argparse
    ap = argparse.ArgumentParser(description="AmbleBee Mission Management")
    ap.add_argument("--repo", help="the pack repo to work on (an empty folder starts a new one)")
    args = ap.parse_args()
    repo = Path(args.repo).expanduser() if args.repo else default_repo()
    if not repo.is_dir():
        sys.exit(f"There's no folder at {repo}. Make an empty one (or clone your pack repo) and try again.")
    use_repo(repo)
    if ready():
        try:
            lib.load_catalog(MISSIONS)
        except ValueError as e:
            sys.exit(f"A mission file won't load, so the manager can't start:\n  {e}")
    for port in PORTS:
        try:
            server = http.server.ThreadingHTTPServer((BIND, port), Handler)
            break
        except OSError:
            continue
    else:
        sys.exit(f"Ports {PORTS.start}-{PORTS.stop - 1} are all busy. Close an old copy of the manager and try again.")
    global SERVER
    SERVER = server
    if ready():
        added = [p for p in PRIVATE if extras.ensure_ignored(ROOT, p)]
        prune_baselines()
    print("AmbleBee Mission Management")
    print(f"  Repo: {ROOT}" + ("" if ready() else "  (not set up yet: the page walks you through it)"))
    if ready() and added:
        print(f"  Added {', '.join(added)} to .gitignore (they only mean something on this computer).")
    # AMBLE_HOST: the address(es) you reach this machine by, e.g. a Tailscale IP or name, comma separated. Set it in
    # a container's compose file, since a container can't see the server's own addresses.
    hosts = [h.strip() for h in os.environ.get("AMBLE_HOST", "").split(",") if h.strip()]
    ts_ip, _ = tailscale_links()
    in_docker = Path("/.dockerenv").exists()
    ip = None if in_docker else lan_ip()      # a container only sees its own Docker network address
    for h in hosts:
        print(f"  Your address:   http://{h}:{port}/")
    print(f"  This computer:  http://localhost:{port}/")
    print(f"  Same Wi-Fi:     http://{ip if ip and not ip.startswith('127.') and ip != ts_ip else 'LANIP'}:{port}/")
    print(f"  Tailscale:      http://{ts_ip or 'TAILSCALEIP'}:{port}/")
    if in_docker:
        print(f"  (In a container: needs  - {port}:{port}  under ports: in the compose file, then docker compose up -d.)")
    print(f"Saving writes straight into {MISSIONS}. Commit and push when you're happy.")
    print("Stop it with the Stop button on the page, or Ctrl+C here.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    server.server_close()
    print("\nStopped.")


if __name__ == "__main__":
    main()
