"""AmbleBee Mission Management: see how balanced each pack is, and edit or add missions in the browser.

    python tools/mission_management

Then open the link it prints. Ctrl+C stops it.

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
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent))     # tools/, for missions_lib
sys.path.insert(0, str(HERE))

import yaml  # noqa: E402

import coverage  # noqa: E402
import missions_lib as lib  # noqa: E402
from writer import chunks, comments_in, dump_mission, same_data  # noqa: E402

MISSIONS = ROOT / "missions"
PORTS = range(8812, 8822)
KEY = secrets.token_urlsafe(12)
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


def dashboard_data():
    packs, rows, note = coverage.load(MISSIONS)
    return {
        "packs": packs, "missions": attention(rows), "note": note,
        "attention": {k: {"label": v[0], "help": v[1]} for k, v in ATTENTION.items()},
        "themes": lib.THEMES, "themeGroups": THEME_GROUPS, "themesMax": lib.THEMES_MAX,
        "targets": coverage.TARGETS, "topThemeMax": coverage.TOP_THEME_MAX,
        "minMissions": coverage.MIN_MISSIONS, "nonState": sorted(coverage.NON_STATE),
        "schema": {
            "allowed": {k: sorted(v) for k, v in lib.ALLOWED.items()},
            "lists": {k: sorted(v) for k, v in lib.LIST_ALLOWED.items()},
            "gear": sorted(lib.GEAR), "rent": ["on-site", "nearby", "no"],
            "limits": {"short": lib.SHORT_MAX, "description": lib.DESCRIPTION_MAX, "about": lib.ABOUT_MAX,
                       "caution": lib.CAUTION_MAX, "credit": lib.CREDIT_MAX, "links": lib.LINKS_MAX,
                       "linkLabel": lib.LINK_LABEL_MAX},
        },
    }


def read_mission(pack, mid):
    path = mission_path(pack, mid)
    text = path.read_text(encoding="utf-8")
    *_, dups = chunks(text)
    return {"data": for_form(yaml.safe_load(text) or {}), "version": version_of(text), "text": text,
            "comments": comments_in(text.splitlines()), "duplicates": dups,
            "path": str(path.relative_to(ROOT))}


# ---------- needs attention ----------

STALE_DAYS = 182     # a live mission last checked more than about six months ago
ATTENTION = {        # code: (label shown on the dashboard, what it means)
    "fails-check": ("Fails a check", "Something tools/check_missions.py flags; open it to see what"),
    "doubled": ("Field written twice", "YAML only keeps the last copy; delete the one you don't want"),
    "approx-pin": ("Pin to verify", "A note in the file says the pin or address still needs checking"),
    "no-pin": ("No pin yet", "A state mission with no coords"),
    "caution-expired": ("Expired caution", "The caution_until date has passed; delete both caution lines"),
    "stale": ("Checked 6+ months ago", "Worth a fresh look: hours, prices and places change"),
    "no-themes": ("No themes", "Won't show under any of the website's theme chips"),
    "no-about": ("No 'About this place'", "State missions only; the page is thinner without it"),
    "draft": ("Draft", "Waiting to be checked and published"),
}
VERIFY_NOTE = re.compile(r"\bapprox|\bverify\b|\bplaceholder|\btodo\b", re.I)


_checked = {"sig": None, "problems": []}


def catalog_problems():
    """check_catalog() for the whole catalog, rerun only when a mission file changed (it takes a couple of seconds)."""
    sig = tuple((str(f), f.stat().st_mtime_ns, f.stat().st_size) for f in sorted(MISSIONS.rglob("*.yaml")))
    if sig != _checked["sig"]:
        _checked.update(sig=sig, problems=lib.check_catalog(MISSIONS))
    return _checked["problems"]


_files = {}   # path: ((mtime, size), (data, has doubled fields, has a "pin to verify" note))


def file_facts(path):
    """Reading 600 YAML files takes a few seconds, so each is reread only when it changes."""
    st = path.stat()
    key = (st.st_mtime_ns, st.st_size)
    if path not in _files or _files[path][0] != key:
        text = path.read_text(encoding="utf-8")
        draft_notes = set(comments_in(chunks(text)[1].get("draft", [])))   # the draft line's own note is the "Draft" badge
        approx = any(VERIFY_NOTE.search(c) for c in comments_in(text.splitlines()) if c not in draft_notes)
        _files[path] = (key, (yaml.safe_load(text) or {}, bool(lib.duplicate_fields(text)), approx))
    return _files[path][1]


def attention(rows):
    """Adds `issues` (codes from ATTENTION) and, when it fails a check, `problems` to each mission row."""
    by_file = {}
    for p in catalog_problems():
        where, _, msg = p.partition(": ")
        by_file.setdefault(where, []).append(msg or p)
    today = datetime.date.today()
    for r in rows:
        rel = f"{r['pack']}/{r['id']}.yaml"
        data, doubled, approx = file_facts(MISSIONS / rel)
        state = r["pack"] not in coverage.NON_STATE
        issues = []
        if rel in by_file:
            issues.append("fails-check")
            r["problems"] = by_file[rel]
        if doubled:
            issues.append("doubled")
        if approx:
            issues.append("approx-pin")
        if state and not ((data.get("place") or {}).get("coords")):
            issues.append("no-pin")
        until = lib.caution_until_date(data.get("caution_until"))
        if data.get("caution") and until and until < today:
            issues.append("caution-expired")
        checked = lib.caution_until_date(data.get("checked"))
        if not data.get("draft") and checked and (today - checked).days > STALE_DAYS:
            issues.append("stale")
        if not data.get("themes"):
            issues.append("no-themes")
        if state and not data.get("about"):
            issues.append("no-about")
        if data.get("draft"):
            issues.append("draft")
        r["issues"] = issues
        r["hasPin"] = bool((data.get("place") or {}).get("coords"))
    return rows


# ---------- saving: work out exactly what would be written, then (only for a save) write it ----------

def _empty(v):
    return v is None or v == "" or v == [] or v == {}


def clean(data, old):
    """Tidy what the form sent: folded paragraphs, no blank fields (unless the file already had one)."""
    out = {}
    for k, v in data.items():
        if k in FOLDED and isinstance(v, str):
            paras = [" ".join(p.split()) for p in re.split(r"\n\s*\n", v.strip()) if p.strip()]
            v = "\n".join(paras)
        elif isinstance(v, str):
            v = v.strip()
        elif isinstance(v, list):
            v = [x.strip() if isinstance(x, str) else x for x in v]
            v = [x for x in v if not _empty(x)]
        elif isinstance(v, dict):
            v = clean(v, old.get(k) if isinstance(old.get(k), dict) else {})
        if k == "links" and isinstance(v, list):
            v = [l for l in v if isinstance(l, dict) and (l.get("label") or l.get("url"))]
        if k == "gear" and isinstance(v, list):
            v = [g for g in v if isinstance(g, dict) and g.get("item")]
        if _empty(v) and not (k in old and _empty(old[k]) and v == old[k]):
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
        try:
            text, lost = dump_mission(data, base or None)
        except ValueError as e:
            return 500, {"error": str(e)}, None, None
        if base and "draft" in (yaml.safe_load(base) or {}) and "draft" not in data:
            # publishing: the note on the draft line ("delete this line once it's checked") is meant to go
            draft_notes = comments_in(chunks(base)[1].get("draft", []))
            lost = [c for c in lost if c not in draft_notes]
    if not is_new and text == original:
        return 200, {"unchanged": True, "diff": [], "lost": [], "problems": [], "text": text}, path, None
    diff = list(difflib.unified_diff(original.splitlines(), text.splitlines(),
                                     "before" if original else "new file", "after", lineterm="", n=2))[2:]
    problems = validate(pack, mid, text) if body.get("check", True) else []   # switching to YAML just needs the text
    return 200, {"diff": diff, "lost": lost, "problems": problems, "text": text}, path, text


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
    tmp = path.with_name(f".{path.stem}.yaml.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
    return 200, {"ok": True, "version": version_of(text), "path": str(path.relative_to(ROOT))}


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
        self.end_headers()
        self.wfile.write(raw)

    def _route(self):
        """The path without any prefix a proxy added (code-server serves this at /proxy/<port>/ or
        /absproxy/<port>/), so the manager works both directly and through an editor's port proxy."""
        path = urllib.parse.urlparse(self.path).path
        for marker in ("/api/", "/fonts/"):
            at = path.find(marker)
            if at > 0:
                return path[at:]
        return "/" if path.endswith("/") else path

    def _authed(self):
        return secrets.compare_digest(self.headers.get("X-Amble-Key", ""), KEY)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        path = self._route()
        if path == "/":
            if not secrets.compare_digest((q.get("key") or [""])[0], KEY):
                return self._send(403, b"<p style='font-family:sans-serif'>Open the link printed in the terminal "
                                       b"(it has a key that changes every run).</p>", "text/html; charset=utf-8")
            return self._send(200, (HERE / "app.html").read_bytes(), "text/html; charset=utf-8")
        if path.startswith("/fonts/"):
            f = ROOT / "site" / "fonts" / Path(path).name
            if f.suffix == ".woff2" and f.exists():
                return self._send(200, f.read_bytes(), "font/woff2")
            return self._send(404, {"error": "no such font"})
        if not self._authed():
            return self._send(403, {"error": "Missing or wrong key. Open the link printed in the terminal."})
        try:
            if path == "/api/data":
                return self._send(200, dashboard_data())
            if path == "/api/mission":
                pack, mid = (q.get("pack") or [""])[0], (q.get("id") or [""])[0]
                if not lib.ID_RE.match(mid) or not lib.ID_RE.match(pack) or not mission_path(pack, mid).exists():
                    return self._send(404, {"error": "No such mission."})
                return self._send(200, read_mission(pack, mid))
        except ValueError as e:      # a mission file that won't load
            return self._send(500, {"error": str(e)})
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        if not self._authed():
            return self._send(403, {"error": "Missing or wrong key. Open the link printed in the terminal."})
        path = self._route()
        if path not in ("/api/mission", "/api/preview", "/api/parse") or \
                "application/json" not in self.headers.get("Content-Type", ""):
            return self._send(404, {"error": "Not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if path == "/api/preview":          # what a save would change, without writing anything
                code, out, _, _ = prepare(body)
            elif path == "/api/parse":          # the YAML editor's text, read back for the form
                data, err = parse_yaml(str(body.get("yaml") or ""))
                code, out = 200, ({"data": for_form(data), "duplicates": [d[0] for d in lib.duplicate_fields(str(body.get("yaml")))]}
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
    try:
        lib.load_catalog(MISSIONS)
    except ValueError as e:
        sys.exit(f"A mission file won't load, so the manager can't start:\n  {e}")
    for port in PORTS:
        try:
            server = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
            break
        except OSError:
            continue
    else:
        sys.exit(f"Ports {PORTS.start}-{PORTS.stop - 1} are all busy. Close an old copy of the manager and try again.")
    print("AmbleBee Mission Management")
    print(f"  This computer:  http://localhost:{port}/?key={KEY}")
    ip = lan_ip()
    ts_ip, ts_name = tailscale_links()
    if ip and not ip.startswith("127.") and ip != ts_ip:
        print(f"  Same Wi-Fi:     http://{ip}:{port}/?key={KEY}")
    if ts_ip:
        print(f"  Tailscale:      http://{ts_ip}:{port}/?key={KEY}")
        if ts_name:
            print(f"                  http://{ts_name}:{port}/?key={KEY}")
    if Path("/.dockerenv").exists():
        print("  Running in a container, so the links above may not reach it from outside.")
        print(f"  Through the editor's port proxy: <your editor's address>/proxy/{port}/?key={KEY}")
    print("Saving writes straight into missions/. Commit and push when you're happy. Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
