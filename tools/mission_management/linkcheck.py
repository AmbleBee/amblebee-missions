"""Link checker: are a mission's website and extra links still alive, or have they moved?

    check_url(url)          one link: ok, moved, broken, or unknown (the site wouldn't say)
    mission_links(m)        [(label, url)] for one mission
    RUN.start(missions)     check every live mission's links in a background thread
    RUN.status()            progress and results while it runs, and after

Results are kept in memory for this run of the manager (and an hour per link), never written to the repo.
Sites that block automated checkers (403, 429, bot walls) count as "unknown", not broken, so a dead link
is a real one. Nothing about you is sent: requests carry a plain browser-like name and nothing else.
"""
import concurrent.futures
import datetime
import socket
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; AmbleBee-MissionManager/1.0; link check)"
TIMEOUT = 12
FRESH_S = 3600          # a link checked within the last hour isn't checked again
WORKERS = 8
_cache = {}             # url -> result
_lock = threading.Lock()


def _same_place(a, b):
    """True when two URLs are the same page give or take http/https, www., a trailing slash or a query."""
    def key(u):
        p = urllib.parse.urlsplit(u)
        host = (p.hostname or "").lower()
        host = host[4:] if host.startswith("www.") else host
        return host, p.path.rstrip("/") or "/"
    return key(a) == key(b)


def _open(url, method):
    req = urllib.request.Request(url, method=method, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.8"})
    if method == "GET":
        req.add_header("Range", "bytes=0-2047")      # just enough to know the page is there
    return urllib.request.urlopen(req, timeout=TIMEOUT, context=ssl.create_default_context())


def check_url(url, force=False):
    """{url, status, code, final, note, checked}. status: ok | moved | broken | unknown."""
    with _lock:
        hit = _cache.get(url)
    if hit and not force and time.time() - hit["_t"] < FRESH_S:
        return hit
    res = {"url": url, "status": "unknown", "code": None, "final": None, "note": ""}
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        res.update(status="broken", note="not a web address")
    else:
        for method in ("HEAD", "GET"):            # some sites refuse HEAD; GET settles it
            try:
                with _open(url, method) as r:
                    res["code"] = r.status
                    final = r.geturl()
                    if final and not _same_place(url, final):
                        res.update(status="moved", final=final, note=f"now goes to {final}")
                    else:
                        res.update(status="ok", note="works")
                break
            except urllib.error.HTTPError as e:
                res["code"] = e.code
                if method == "HEAD" and (e.code in (400, 403, 404, 405, 406, 429, 500, 501, 503) or 520 <= e.code <= 530):
                    continue                       # try a GET before deciding
                if e.code in (404, 410):
                    res.update(status="broken", note=f"page not found ({e.code})")
                elif e.code in (401, 403, 406, 429, 503) or 520 <= e.code <= 530:   # 52x: Cloudflare in front of the site
                    res.update(status="unknown", note=f"the site wouldn't let the checker in ({e.code}); open it yourself")
                else:
                    res.update(status="broken" if e.code >= 500 else "unknown", note=f"the site answered {e.code}")
            except urllib.error.URLError as e:
                why = getattr(e, "reason", e)
                if isinstance(why, socket.gaierror):
                    res.update(status="broken", note="the website's address doesn't exist any more")
                elif isinstance(why, ssl.SSLError):
                    res.update(status="unknown", note="the site's security certificate has a problem")
                elif isinstance(why, (socket.timeout, TimeoutError)):
                    res.update(status="unknown", note="the site took too long to answer")
                else:
                    res.update(status="unknown", note=f"couldn't reach it ({why})")
                break
            except (socket.timeout, TimeoutError):
                res.update(status="unknown", note="the site took too long to answer")
                break
            except (OSError, ValueError) as e:
                res.update(status="unknown", note=f"couldn't check it ({e})")
                break
    res["checked"] = datetime.datetime.now().strftime("%H:%M")
    res["_t"] = time.time()
    with _lock:
        _cache[url] = res
    return res


# ---------- links you've marked good yourself (missions/links-ok.yaml, kept with the repo) ----------

OK_FILE = None      # set by the manager to <repo>/missions/links-ok.yaml
MARK_DAYS = 180     # a mark lasts this long, then the link gets checked like any other again


def _expired(day):
    try:
        return (datetime.date.today() - datetime.date.fromisoformat(str(day))).days > MARK_DAYS
    except ValueError:
        return True


def expires(day):
    """The day a mark made on `day` stops counting."""
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=MARK_DAYS)).isoformat()


def marks():
    """{url: "YYYY-MM-DD"} for links marked good by hand within the last MARK_DAYS (older marks don't count)."""
    import yaml
    if not OK_FILE or not OK_FILE.exists():
        return {}
    try:
        data = yaml.safe_load(OK_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        return {}
    return {str(k): str(v) for k, v in data.items() if not _expired(v)} if isinstance(data, dict) else {}


def set_mark(url, good):
    """Marks (or unmarks) a link as good. Returns the date it was marked, or None."""
    import json
    m = marks()
    if good:
        m[url] = datetime.date.today().isoformat()
    else:
        m.pop(url, None)
    lines = ["# Links that work even though the link checker can't confirm it (a site that blocks checkers).",
             "# The mission manager's \"Mark as good\" button writes these; Unmark removes them.",
             f"# Each mark lasts {MARK_DAYS} days, then the link is checked like any other again (expired marks drop off here)."]
    lines += [f"{json.dumps(u)}: {d}" for u, d in sorted(m.items())]
    OK_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return m.get(url)


def with_mark(res, mk=None):
    """A result with `manual` (the date it was marked good) when it has a mark; a marked link counts as ok."""
    mk = marks() if mk is None else mk
    out = {k: v for k, v in res.items() if k != "_t"}
    if res.get("url") in mk:
        out["manual"] = mk[res["url"]]
        out["manual_until"] = expires(mk[res["url"]])
    return out


def mission_links(m):
    """[(label, url)]: the place's website and its extra link buttons."""
    place = m.get("place") or {}
    out = []
    if place.get("website"):
        out.append(("Website", place["website"]))
    for l in place.get("links") or []:
        if isinstance(l, dict) and l.get("url"):
            out.append((str(l.get("label") or "Link"), l["url"]))
    return out


def results_for(m, mk=None):
    """Cached results for one mission's links (no network), [] when none are known yet."""
    mk = marks() if mk is None else mk
    out = []
    with _lock:
        for label, url in mission_links(m):
            if url in _cache:
                out.append({**with_mark(_cache[url], mk), "label": label})
    return out


def check_mission(m, force=False):
    links = mission_links(m)
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        found = list(ex.map(lambda lu: check_url(lu[1], force), links))
    mk = marks()
    return [{**with_mark(r, mk), "label": label} for (label, _), r in zip(links, found)]


class _Runner:
    """Checks every link in the background so the page stays usable; one run at a time."""

    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"running": False, "done": 0, "total": 0, "started": None, "finished": None}

    def start(self, missions):
        with self.lock:
            if self.state["running"]:
                return False
            urls = sorted({u for m in missions for _, u in mission_links(m)})
            self.state = {"running": True, "done": 0, "total": len(urls), "started": datetime.datetime.now().strftime("%H:%M"),
                          "finished": None}
        threading.Thread(target=self._run, args=(urls,), daemon=True).start()
        return True

    def _run(self, urls):
        def one(u):
            check_url(u, force=True)
            with self.lock:
                self.state["done"] += 1
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            list(ex.map(one, urls))
        with self.lock:
            self.state.update(running=False, finished=datetime.datetime.now().strftime("%H:%M"))

    def status(self):
        with self.lock:
            st = dict(self.state)
        mk = marks()
        with _lock:
            counts = {"broken": 0, "moved": 0, "unknown": 0, "ok": 0}
            for u, r in _cache.items():
                st_ = "ok" if u in mk else r["status"]
                counts[st_] = counts.get(st_, 0) + 1
        return {**st, "counts": counts}


RUN = _Runner()
