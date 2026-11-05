"""AmbleBee Mission Management: see how balanced each pack is, and edit or add missions in the browser.

    python tools/mission_management

Then open the link it prints. Ctrl+C stops it.

What it does
  - Dashboard: indoor/outdoor, cheap/pricier, date/adventure and theme coverage for every pack,
    a gap finder for the packs furthest out of balance, and every mission with its dates.
  - Editing: every field of a mission, with the same rules as tools/check_missions.py. A change that
    would fail those checks isn't saved; you see why instead.
  - Saving writes the YAML file in missions/ directly. Fields you didn't touch keep their exact lines
    (comments included), so `git diff` shows only what you changed. Commit and push as usual.

Safety
  - Anyone on your network could reach the port, so every link carries a random key that changes
    each run. Without it the page shows nothing and nothing can be saved.
  - If a file changed on disk after you opened it (say you edited it in VSCodium), the save is refused
    so neither change gets lost. Reload the mission and redo the edit.
"""
import hashlib
import http.server
import json
import os
import re
import secrets
import shutil
import socket
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
        "packs": packs, "missions": rows, "note": note,
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
    return {"data": for_form(yaml.safe_load(text) or {}), "version": version_of(text),
            "comments": comments_in(text.splitlines()), "duplicates": dups,
            "path": str(path.relative_to(ROOT))}


# ---------- saving ----------

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


def save(body):
    pack, mid, is_new = body.get("pack"), body.get("id"), bool(body.get("isNew"))
    _, packs, _ = lib.load_catalog(MISSIONS)
    if pack not in packs or pack == "general":
        return 400, {"error": f"No pack folder named '{pack}'."}
    if not isinstance(mid, str) or not lib.ID_RE.match(mid):
        return 400, {"error": "The file name (id) can only use lowercase letters, numbers and dashes."}
    path = mission_path(pack, mid)
    if is_new:
        clash = list(MISSIONS.glob(f"*/{mid}.yaml"))
        if clash:
            return 409, {"error": f"There's already a mission called {mid} (in {clash[0].parent.name}/). "
                                  f"Ids are unique across all packs; pick another file name."}
        original, old = None, {}
    else:
        if not path.exists():
            return 404, {"error": f"{path.relative_to(ROOT)} doesn't exist any more."}
        original = path.read_text(encoding="utf-8")
        if version_of(original) != body.get("version"):
            return 409, {"error": "This file changed on disk since you opened it (maybe in your editor). "
                                  "Nothing was saved. Reopen the mission to get the latest version, then redo your edit.",
                         "stale": True}
        old = yaml.safe_load(original) or {}

    data = clean(body.get("data") or {}, old)
    if not is_new and same_data(data, old):
        *_, dups = chunks(original)
        if not dups:
            return 200, {"ok": True, "unchanged": True, "version": version_of(original)}
    try:
        text, lost = dump_mission(data, original)
    except ValueError as e:
        return 500, {"error": str(e)}
    if original and "draft" in old and "draft" not in data:
        # publishing: the note on the draft line ("delete this line once it's checked") is meant to go
        draft_notes = comments_in(chunks(original)[1].get("draft", []))
        lost = [c for c in lost if c not in draft_notes]
    if lost and not body.get("dropComments"):
        return 409, {"error": "Saving would remove comments from lines you changed.", "lost": lost}
    problems = validate(pack, mid, text)
    if problems:
        return 422, {"error": "Not saved: this would fail the mission checks.", "problems": problems}
    tmp = path.with_name(f".{mid}.yaml.tmp")
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

    def _authed(self):
        return secrets.compare_digest(self.headers.get("X-Amble-Key", ""), KEY)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/":
            if not secrets.compare_digest((q.get("key") or [""])[0], KEY):
                return self._send(403, b"<p style='font-family:sans-serif'>Open the link printed in the terminal "
                                       b"(it has a key that changes every run).</p>", "text/html; charset=utf-8")
            return self._send(200, (HERE / "app.html").read_bytes(), "text/html; charset=utf-8")
        if url.path.startswith("/fonts/"):
            f = ROOT / "site" / "fonts" / Path(url.path).name
            if f.suffix == ".woff2" and f.exists():
                return self._send(200, f.read_bytes(), "font/woff2")
            return self._send(404, {"error": "no such font"})
        if not self._authed():
            return self._send(403, {"error": "Missing or wrong key. Open the link printed in the terminal."})
        try:
            if url.path == "/api/data":
                return self._send(200, dashboard_data())
            if url.path == "/api/mission":
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
        if self.path != "/api/mission" or "application/json" not in self.headers.get("Content-Type", ""):
            return self._send(404, {"error": "Not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            code, out = save(body)
        except (ValueError, json.JSONDecodeError) as e:
            code, out = 400, {"error": f"Couldn't read that request ({e})."}
        self._send(code, out)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))     # picks the outgoing interface; nothing is sent
            return s.getsockname()[0]
    except OSError:
        return None


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
    if ip and not ip.startswith("127."):
        print(f"  Other devices:  http://{ip}:{port}/?key={KEY}")
    print("Saving writes straight into missions/. Commit and push when you're happy. Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
