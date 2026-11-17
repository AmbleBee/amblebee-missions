"""Mission Management's safety rules (claude/security-fixes-PLAN.md, Phase 2), checked against a running manager:
a key on every request, this computer only by default, no other host names, JSON-only changes, and a server's
key never printed. Standard library only.

    python tools/mission_management/safety_test.py

It runs the manager on a throwaway copy of this repo (the manager adds lines to .gitignore when it starts)."""
import atexit, json, os, re, shutil, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request
from pathlib import Path
HERE = Path(__file__).resolve().parent
TMP = tempfile.mkdtemp()
atexit.register(shutil.rmtree, TMP, True)
REPO = os.path.join(TMP, "repo")
subprocess.run(["git", "clone", "-q", str(HERE.parent.parent), REPO], check=True)
for f in ("__main__.py", "app.html"):          # the files as they are now, saved or not
    shutil.copy(HERE / f, Path(REPO) / "tools" / "mission_management" / f)
fails = []
def check(name, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [{extra}]"))
    if not ok: fails.append(name)
def start(env, port):
    e = {**{k: v for k, v in os.environ.items() if not k.startswith("AMBLE_")}, "AMBLE_PORT": str(port), **env}
    p = subprocess.Popen([sys.executable, "tools/mission_management", "--repo", REPO], cwd=REPO, env=e,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    out = ""
    for _ in range(100):
        line = p.stdout.readline(); out += line
        if "Stop it with" in line: break
    return p, out
def call(port, path, key=None, host=None, method="GET", body=None, ctype=None, addr="127.0.0.1"):
    h = {}
    if key: h["X-Amble-Key"] = key
    if host: h["Host"] = host
    if ctype: h["Content-Type"] = ctype
    req = urllib.request.Request(f"http://{addr}:{port}{path}", method=method, headers=h, data=body)
    try:
        with urllib.request.urlopen(req, timeout=10) as r: return r.status, r.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
    except OSError as e: return 0, str(e)
def lan_ip():        # this computer's address on the network (where "another device" would connect)
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1)); return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()
lan = lan_ip()

# 1. default: this computer only, always a key
p, out = start({}, 18812)
m = re.search(r"http://localhost:18812/\?key=(\S+)", out)
key = urllib.parse.unquote(m.group(1)) if m else ""
check("default: the start-up link carries a key", bool(key), out)
check("default: no Same Wi-Fi or Tailscale links", "Same Wi-Fi" not in out and "Tailscale" not in out, out)
if lan and not lan.startswith("127."):
    check("default: another device can't connect", call(18812, "/api/lock", addr=lan)[0] == 0, call(18812, "/api/lock", addr=lan))
s, b = call(18812, "/api/data")
check("no key: locked out", s == 403 and json.loads(b).get("locked"), (s, b[:80]))
check("wrong key: locked out", call(18812, "/api/data", key="nope")[0] == 403)
check("the key works", call(18812, "/api/data", key=key)[0] == 200)
check("the page itself still loads (it asks for the key)", call(18812, "/")[0] == 200)
s, b = call(18812, "/api/data", key=key, host="evil.example:18812")
check("another host name is refused (DNS rebinding)", s == 403 and "only answers" in b, (s, b[:80]))
check("localhost by name works", call(18812, "/api/data", key=key, host="localhost:18812")[0] == 200)
check("[::1] works", call(18812, "/api/lock", key=key, host="[::1]:18812")[0] == 200)
s, _ = call(18812, "/api/stop", key=key, method="POST", body=b"x=1", ctype="application/x-www-form-urlencoded")
check("a plain form post can't stop it", s == 404 and p.poll() is None, s)
check("and a post without the key can't either", call(18812, "/api/stop", method="POST", body=b"{}", ctype="application/json")[0] == 403)
s, _ = call(18812, "/api/lock", key=key, method="POST", body=json.dumps({"key": "easy1"}).encode(), ctype="application/json")
check("Lock swaps in an easier key", s == 200 and call(18812, "/api/data", key="easy1")[0] == 200 and call(18812, "/api/data", key=key)[0] == 403)
check("and /api/lock says so", json.loads(call(18812, "/api/lock", key="easy1")[1]).get("custom") is True)
s, b = call(18812, "/api/unlock", key="easy1", method="POST", body=b"{}", ctype="application/json")
check("removing it goes back to the start-up key, never to none",
      s == 200 and call(18812, "/api/data")[0] == 403 and call(18812, "/api/data", key=key)[0] == 200 and call(18812, "/api/data", key="easy1")[0] == 403)
s, _ = call(18812, "/api/stop", key=key, method="POST", body=b"{}", ctype="application/json")
p.wait(timeout=10)
check("Stop works with the key and JSON", s == 200 and p.returncode is not None)

# 2. a new run, a new key
p, out2 = start({}, 18813)
k2 = re.search(r"\?key=(\S+)", out2).group(1)
check("every run gets a new key", k2 != m.group(1))
p.terminate(); p.wait()

# 3. on purpose for other devices
p, out = start({"AMBLE_BIND": "0.0.0.0"}, 18814)
k3 = urllib.parse.unquote(re.search(r"localhost:18814/\?key=(\S+)", out).group(1))
check("AMBLE_BIND=0.0.0.0: Same Wi-Fi link with the key", re.search(r"Same Wi-Fi: +http://\S+:18814/\?key=", out) is not None, out)
if lan and not lan.startswith("127."):
    check("AMBLE_BIND=0.0.0.0: another device can connect, with the key", call(18814, "/api/data", key=k3, addr=lan)[0] == 200)
    check("AMBLE_BIND=0.0.0.0: but not without it", call(18814, "/api/data", addr=lan)[0] == 403)
p.terminate(); p.wait()

# 4. run by a server (intake)
p, out = start({"AMBLE_BIND": "127.0.0.1", "AMBLE_LOCK": "server-key-123"}, 18815)
check("server: the key is never printed", "server-key-123" not in out and "?key=" not in out, out)
check("server: its key works", call(18815, "/api/data", key="server-key-123")[0] == 200)
check("server: Stop, Lock and Remove are refused",
      all(call(18815, x, key="server-key-123", method="POST", body=b'{"key":"abcd"}', ctype="application/json")[0] == 403
          for x in ("/api/stop", "/api/unlock", "/api/lock")))
check("server: any Host is fine (intake's own proxy)", call(18815, "/api/data", key="server-key-123", host="amblebee-intake.example:8443")[0] == 200)
p.terminate(); p.wait()
print("\n" + (f"{len(fails)} failed" if fails else "All checks passed"))
sys.exit(1 if fails else 0)
