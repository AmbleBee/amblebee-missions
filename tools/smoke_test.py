"""Open the built site in a real browser and try the things people actually do.

    python tools/smoke_test.py              # tests _site/
    python tools/smoke_test.py other/folder

Needs Playwright (see README.md). Set SMOKE_ENGINE=firefox or webkit to test in that engine, or SMOKE_CHROME=1
to use an installed Google Chrome instead of Playwright's Chromium. Any failure, or any error in the browser
console, exits with an error, which stops the deploy.
"""
import functools
import http.server
import json
import secrets
import string
from datetime import datetime, timedelta, timezone
import re
import sys
import threading
from pathlib import Path
import os

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PHONE = {"width": 375, "height": 812}
DESKTOP = {"width": 1280, "height": 800}
TIMEOUT_MS = 8000


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(folder):
    handler = functools.partial(QuietHandler, directory=str(folder))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


INTAKE = "https://amblebee-intake.tail58116.ts.net"   # API in site/js/intake.js; the tests stand in for it


class FakeIntake:
    """Answers like AmbleBee Intake would, so the forms can be tested without the real server.
    mode: "up", "paused" (health says not accepting) or "down" (no answer at all)."""

    def __init__(self):
        self.mode, self.posts, self.answered = "up", [], False
        self.headers = []          # (path, request headers) for every POST: the forms carry the profile when signed in
        self.votes = {}            # pub -> a vote, like amblebee-intake's app/polls.py (which has its own tests)
        self.profiles = {}   # key -> {"done": {rid: completion}, "removed": [], "prefs": None, "email": False}
        self.closed = False
        self.thread = [{"who": "them", "at": "2026-11-12T16:00:00+00:00", "body": "Any plans for a Montana pack?"},
                       {"who": "us", "at": "2026-11-13T16:00:00+00:00", "body": "We'd love one! Any favorite spots?"}]

    def handle(self, route):
        req = route.request
        path = req.url.split(INTAKE, 1)[1].split("?")[0]
        cors = {"access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST",
                "access-control-allow-headers": "Content-Type, Authorization, X-Amble-Device, X-Amble-Voter", "content-type": "application/json"}
        if self.mode == "down":
            return route.abort()
        if req.method == "OPTIONS":
            return route.fulfill(status=200, headers=cors, body="")

        def reply(status, body):
            route.fulfill(status=status, headers=cors, body=json.dumps(body))
        if path == "/health":
            return reply(200, {"ok": True, "accepting": self.mode == "up"})
        if path == "/schema":
            return reply(200, {"ok": True, **SCHEMA})
        if path.startswith("/polls"):
            data = json.loads(req.post_data or "{}") if req.method == "POST" else {}
            return self.polls_api(path, req.method, data, req.headers, reply)
        if path.startswith("/messages"):
            data = json.loads(req.post_data or "{}") if req.method == "POST" else {}
            return self.messages(path, data, req.headers.get("authorization", ""), req.headers.get("x-amble-device"), reply)
        if req.method == "POST":
            data = json.loads(req.post_data or "{}")
            self.posts.append((path, data))
            self.headers.append((path, dict(req.headers)))
            if path.startswith("/profile"):
                return self.profile(path, data, req.headers.get("authorization", ""), reply, req.headers.get("x-amble-device"))
            if path == "/status/msg123/close":
                self.closed = True
                return reply(200, {"ok": True})
            if path == "/status/msg123/reply":
                self.closed = False
                self.thread.append({"who": "them", "at": "2026-11-14T16:00:00+00:00", "body": data.get("message", "")})
                return reply(201, {"ok": True})
            if path == "/status/ask123/reply":
                if not str(data.get("message", "")).strip():
                    return reply(400, {"ok": False, "error": "Please check your answer.", "errors": {"message": "Please fill in your answer."}})
                self.answered = True
                return reply(201, {"ok": True})
            if path == "/submit/mission":
                m = data.get("mission") or {}
                if not m.get("name") or not m.get("description"):
                    return reply(400, {"ok": False, "error": "Please check the highlighted fields.", "errors": {"name": "Give the mission a name."}})
                return reply(201, {"ok": True, "token": "tok123", "status_url": "https://amblebee.com/status/#tok123"})
            need = {"/submit/idea": ["title", "body"], "/report": ["body"], "/contact": ["name", "email", "subject", "message"]}.get(path)
            if need is None:
                return reply(404, {"ok": False})
            errors = {f: "Please fill this in." for f in need if not str(data.get(f, "")).strip()}
            if errors:
                return reply(400, {"ok": False, "error": "Please check the highlighted fields.", "errors": errors})
            if path == "/report" and not data.get("follow"):
                return reply(201, {"ok": True})
            if path == "/contact":
                return reply(201, {"ok": True, "token": "msg123", "status_url": "https://amblebee.com/status/#msg123"})
            return reply(201, {"ok": True, "token": "tok123", "status_url": "https://amblebee.com/status/#tok123"})
        if path == "/status/tok123":
            return reply(200, {"ok": True, "kind": "idea", "title": "Tide pools", "status": "in_review", "headline": "In review",
                               "text": "We're reading it now.", "closed": False, "created_at": "2026-11-12T16:00:00+00:00",
                               "steps": [{"status": s, "label": s} for s in ("received", "in_review", "working", "approved", "live")],
                               "history": [{"status": "received", "label": "Received", "at": "2026-11-12T16:00:00+00:00"},
                                           {"status": "in_review", "label": "In review", "at": "2026-11-14T18:00:00+00:00"}]})
        if path == "/status/msg123":
            mine = self.thread[-1]["who"] == "them"
            status, headline, text = (("received", "Received", "It's waiting to be read.") if mine else
                                      ("waiting", "We wrote back", "We replied and need a little more from you. See below."))
            if self.closed:
                status, headline, text = "done", "Closed", "You closed this conversation. Need anything else? Reply below and it opens again."
            return reply(200, {"ok": True, "kind": "contact", "title": "A Montana pack?", "closed": self.closed,
                               "status": status, "headline": headline, "text": text, "days": 30,
                               "created_at": "2026-11-12T16:00:00+00:00", "due": "2026-12-13T16:00:00+00:00" if status == "waiting" else None,
                               "steps": [{"status": s, "label": s} for s in ("received", "open", "done")], "history": [],
                               "thread": self.thread, "can_reply": True, "can_close": not self.closed})
        if path == "/status/ask123":
            waiting = not self.answered
            view = {"ok": True, "kind": "idea", "title": "Covered bridge loop", "closed": False, "created_at": "2026-11-12T16:00:00+00:00",
                    "status": "needs_info" if waiting else "working", "headline": "We have a question" if waiting else "Working on it",
                    "text": "We need a little more from you. See below." if waiting else "We're looking into it: checking the place and the details. It isn't approved yet.",
                    "steps": [{"status": s, "label": s} for s in ("received", "in_review", "working", "approved", "live")],
                    "history": [{"status": "received", "label": "Received", "at": "2026-11-12T16:00:00+00:00"}]}
            if waiting:
                view.update(question="Which bridge do you start at?", due="2026-12-12T16:00:00+00:00", step="working")
            return reply(200, view)
        return reply(404, {"ok": False, "error": "not found"})


    def _gate(self, auth, device, reply):
        """The profile for this key, or an answer already sent (gone, or PIN needed). Gives a device token when asked."""
        key = auth[8:] if auth.startswith("Profile ") else ""
        prof = self.profiles.get(key)
        if prof is None:
            reply(401, {"ok": False, "error": "We couldn't find that profile.", "gone": True})
            return None, None
        devices = prof.setdefault("devices", set())
        if prof.get("pin") and device not in devices:
            reply(403, {"ok": False, "error": "Enter your PIN to open this profile on this device.", "pin_needed": True})
            return None, None
        new = None
        if device is not None and device not in devices:
            new = "d" + secrets.token_hex(8)[:21]
            new = (new + "x" * 22)[:22]
            devices.add(new)
        return prof, new

    def vote_view(self, v, who):
        """What GET /polls/<pub> answers, for the person `who` (a profile key or a voter token)."""
        mine = who == v["creator"]
        b = v["ballots"].get(who)
        out = {k: v[k] for k in ("pub", "kind", "style", "name", "for_date", "status", "closes_at", "profiles_only", "names_public", "options")}
        out.update(now=datetime.now(timezone.utc).isoformat(), ended_at=v.get("ended_at"), started_by=v.get("started_by", ""), voters=len(v["ballots"]),
                   you={"voted": bool(b), "choice": b["choice"] if b else None, "name": b["name"] if b else None, "creator": mine,
                        "signed_in": who in self.profiles})
        out["names"] = ([{"id": i, "name": x["name"], "hidden": bool(x.get("hidden"))} for i, x in enumerate(v["ballots"].values()) if x["name"]] if mine
                        else [{"name": x["name"]} for x in v["ballots"].values() if x["name"] and not x.get("hidden")])
        if mine:
            out["hours"] = {"cap": 48, "free": 24}
        if v["status"] == "finished":
            out["result"], out["coin_flip"] = v["result"], False
        if v["kind"] == "official":
            out.update(profile_required=v.get("profile_required", False), allow_other=v.get("allow_other", False), opens_at=v.get("opens_at"))
            out.pop("names", None)
            if v["status"] == "finished":
                out["staff"] = v["staff"]
        return out

    def polls_api(self, path, method, data, headers, reply):
        auth = headers.get("authorization", "")
        key = auth[8:] if auth.startswith("Profile ") else ""
        who = key if key in self.profiles else headers.get("x-amble-voter", "")
        parts = path.strip("/").split("/")
        if path == "/polls" and method == "POST":
            if key not in self.profiles:
                return reply(403, {"ok": False, "error": "Start a free profile to make a vote.", "reason": "profile"})
            pub = ("V" + secrets.token_hex(8))[:16]
            self.votes[pub] = {"pub": pub, "kind": "friends", "style": data["style"], "name": data["name"], "for_date": data["for_date"],
                               "status": "open", "closes_at": (datetime.now(timezone.utc) + timedelta(hours=data["hours"])).isoformat(),
                               "profiles_only": bool(data.get("profiles_only")), "names_public": data.get("names_public", True),
                               "creator": key, "ballots": {}, "sent": data,
                               "options": [{"id": i + 1, "mission": m["id"], "slug": m["id"].split("/")[1], "name": m["name"], "place": m.get("place"),
                                            "season": ["any"]} for i, m in enumerate(data["missions"])]}
            return reply(201, {"ok": True, **self.vote_view(self.votes[pub], who)})
        if path == "/polls/official":
            off = [v for v in self.votes.values() if v["kind"] == "official"]
            item = lambda v: {"pub": v["pub"], "name": v["name"], "closes_at": v["closes_at"], "voters": len(v["ballots"]),
                              "profile_required": v.get("profile_required", False)}
            return reply(200, {"ok": True, "upcoming": [{**item(v), "opens_at": v["opens_at"]} for v in off if v["status"] == "open" and v.get("opens_at")],
                               "open": [item(v) for v in off if v["status"] == "open" and not v.get("opens_at")],
                               "reviewing": [item(v) for v in off if v["status"] == "closed"], "results": []})
        if path == "/polls/mine":
            return reply(200, {"ok": True, "votes": [self.vote_view(v, who) for v in self.votes.values() if v["creator"] == key],
                               "hours": {"cap": 48, "used": 0, "free": 48}})
        v = self.votes.get(parts[1]) if len(parts) > 1 else None
        if v is None:
            return reply(404, {"ok": False, "error": "This vote has been removed.", "removed": True})
        if len(parts) == 3 and parts[2] == "ballot":
            if v["kind"] == "official" and v.get("profile_required") and who not in self.profiles:
                return reply(403, {"ok": False, "error": "This poll needs a profile.", "reason": "profile"})
            v["ballots"][who] = {"choice": data.get("choice"), "name": data.get("name") or None, **({"other": data["other"]} if data.get("other") else {})}
        elif len(parts) == 5 and parts[2] == "names" and who == v["creator"]:
            list(v["ballots"].values())[int(parts[3])]["hidden"] = parts[4] == "hide"
        elif len(parts) == 3 and parts[2] == "finish" and who == v["creator"]:
            self.finish_vote(v)
        return reply(200, {"ok": True, **self.vote_view(v, who)})

    def finish_vote(self, v):
        counts = {o["id"]: 0 for o in v["options"]}
        for b in v["ballots"].values():
            counts[b["choice"][0]] += 1
        scores = sorted(({"option": k, "points": n, "first": n} for k, n in counts.items()), key=lambda x: -x["points"])
        for i, x in enumerate(scores):
            x["place"] = i + 1
        v.update(status="finished", ended_at=datetime.now(timezone.utc).isoformat(),
                 result={"scores": scores, "voters": len(v["ballots"]), "winner": scores[0]["option"] if v["ballots"] else None})

    def messages(self, path, data, auth, device, reply):
        """GET /messages, GET /messages/<ref>, POST /messages/<ref>/reply, like amblebee-intake's app/messages.py."""
        prof, _ = self._gate(auth, device, reply)
        if prof is None:
            return
        convos = prof.setdefault("messages", {})
        if path == "/messages":
            return reply(200, {"ok": True, "conversations": [{k: v for k, v in c.items() if k != "thread"} for c in convos.values()]})
        ref = path.split("/")[2]
        c = convos.get(ref)
        if c is None:
            return reply(404, {"ok": False, "error": "We couldn't find that conversation."})
        if path.endswith("/reply"):
            if c["closed"]:
                return reply(400, {"ok": False, "error": "Please check your reply.", "errors": {"message": "This conversation is closed. Need more help? Start a new message."}})
            c["thread"].append({"who": "them", "at": datetime.now(timezone.utc).isoformat(), "body": data.get("message", "")})
        c["unread"] = False
        view = {**c, "ok": True, "can_reply": not c["closed"], "headline": c["status"], "text": "", "kind": c["kind"]}
        return reply(201 if path.endswith("/reply") else 200, view)

    def profile(self, path, data, auth, reply, device=None):
        """Website profiles, like amblebee-intake's app/profiles.py (which has its own tests for the details)."""
        now = datetime.now(timezone.utc).isoformat()
        if path == "/profile":
            key = data.get("key", "")
            if len(key) != 22:
                return reply(400, {"ok": False, "errors": {"key": "bad"}})
            if "@" not in (data.get("email") or "@x.y") and data.get("email"):
                return reply(400, {"ok": False, "errors": {"email": "That email doesn't look right."}})
            self.profiles.setdefault(key, {"done": {}, "removed": [], "prefs": None, "email": bool(data.get("email")),
                                           "vault": {"wk": None, "we": None, "salt": None, **(data.get("vault") or {})}})
            return reply(201, {"ok": True, "created": True})
        if path == "/profile/lost":
            return reply(200, {"ok": True})
        key = auth[8:] if auth.startswith("Profile ") else ""
        if path == "/profile/unlock":
            prof = self.profiles.get(key)
            if prof is None:
                return reply(401, {"ok": False, "gone": True})
            if data.get("pin") != prof.get("pin"):
                return reply(403, {"ok": False, "error": "That's not the right PIN.", "wrong_pin": True})
            tok = ("u" + secrets.token_hex(12))[:22]
            prof.setdefault("devices", set()).add(tok)
            return reply(200, {"ok": True, "device": tok})
        prof, new_device = self._gate(auth, device, reply)
        if prof is None:
            return
        if path == "/profile/pin":
            if prof.get("pin") and data.get("current") != prof["pin"]:
                return reply(403, {"ok": False, "error": "That's not the right PIN.", "wrong_pin": True})
            prof["pin"] = data.get("pin") or None
            return reply(200, {"ok": True, "pin": bool(prof["pin"]), **({"device": new_device} if new_device else {})})
        if path == "/profile/devices":
            if data.get("sign_out") == "others":
                prof["devices"] = {device} & prof["devices"]
            if data.get("sign_out") == "this":
                prof["devices"].discard(device)
            return reply(200, {"ok": True, "devices": [{"id": i, "label": "Chrome on Linux", "first_seen": "2026-11-18T10:00:00+00:00",
                                                         "last_seen": "2026-11-18T10:00:00+00:00", "this": d == device}
                                                        for i, d in enumerate(sorted(prof["devices"]))]})
        if path == "/profile/remove":
            del self.profiles[key]
            return reply(200, {"ok": True})
        prof.setdefault("vault", {"wk": None, "we": None, "salt": None})
        if path == "/profile/email":
            prof["email"] = bool(data.get("email"))
            prof["vault"].update((data.get("vault") or {}) if prof["email"] else {"we": None, "salt": None})
            return reply(200, {"ok": True, "email": prof["email"]})
        if path == "/profile/vault":
            prof["vault"]["wk"] = (data.get("vault") or {}).get("wk")
            return reply(200, {"ok": True})
        for rid in data.get("removed") or []:
            prof["done"].pop(rid, None)
            prof["removed"].append(rid)
        for c in data.get("done") or []:
            if c["rid"] not in prof["removed"]:
                old = prof["done"].get(c["rid"], {})
                prof["done"][c["rid"]] = {**c, "note": c.get("note", old.get("note", ""))}
        if data.get("prefs"):
            prof["prefs"] = data["prefs"]
        plans, gone = prof.setdefault("plans", {}), prof.setdefault("plans_removed", [])
        for pid in data.get("plans_removed") or []:
            plans.pop(pid, None)
            gone.append(pid)
        for x in data.get("plans") or []:
            if x["id"] not in gone:
                plans[x["id"]] = x
        return reply(200, {"ok": True, "now": now, "done": list(prof["done"].values()), "removed": prof["removed"],
                           "prefs": prof["prefs"], "email": prof["email"], "created_at": now, "vault": prof["vault"],
                           "plans": list(plans.values()), "plans_removed": gone, "pin": bool(prof.get("pin")),
                           "messages_unread": sum(1 for c in prof.get("messages", {}).values() if c["unread"]),
                           **({"device": new_device} if new_device else {})})


SCHEMA = {   # a small stand-in for AmbleBee Intake's GET /schema
    "packs": [{"id": "oregon", "name": "Amble Oregon", "places": "required"}, {"id": "anywhere", "name": "Amble Anywhere", "places": "none"}],
    "allowed": {"mode": ["date", "adventure", "both"], "who": ["solo", "friends", "family", "kids"], "duration": ["short", "half-day", "all-day"],
                "effort": ["easy", "moderate", "hard"], "cost": ["free", "$", "$$", "$$$"], "setting": ["indoor", "outdoor", "either"],
                "season": ["spring", "summer", "fall", "winter"], "time_of_day": ["any", "morning", "daytime", "evening", "night"],
                "travel": ["home", "local", "drive", "day-trip"], "check_ahead": ["hours", "tickets"], "discounts": ["senior", "student"]},
    "labels": {"mode": {"date": "Date", "adventure": "Adventure", "both": "Date or adventure"}, "cost": {"$": "Under $20 for two"},
               "rent": {"on-site": "Rent it there", "nearby": "Rent it nearby", "no": "Bring your own"}},
    "gear": ["bikes", "headlamps", "life-jackets"], "rent": ["on-site", "nearby", "no"],
    "themes": {"beach": "Beaches & coast", "wildlife": "Animals & wildlife", "drinks": "Wine, beer & cocktails", "playful": "Playful & silly"},
    "theme_groups": {"Outdoors": ["beach", "wildlife"], "Fun": ["drinks"], "Feel": ["playful"]}, "themes_max": 6,
    "limits": {"name": 80, "short": 100, "description": 800, "about": 1500, "caution": 200, "credit": 40},
    "couple_words": r"\b(the two of you|you two|both of you|your partner|your date|hold hands)\b",
    "tips": {"name": "Short and specific beats clever.", "coords": "Right-click the entrance in Google Maps."},
}


def expected(message):
    """The browser logs an API's 400 (a form with a mistake) or an outage as an error. Those are the forms
    working as designed, so they don't fail a test; every other console error still does."""
    where = (message.location or {}).get("url", "")
    return message.type == "error" and (INTAKE in where or INTAKE in message.text)   # Chromium and WebKit word it differently


class Site:
    """A fresh page for each test. Motion is reduced so envelopes open right away."""

    def __init__(self, browser, base):
        self.browser, self.base, self.errors = browser, base, []
        self.intake = FakeIntake()

    def open(self, path="/", viewport=DESKTOP):
        ctx = self.browser.new_context(viewport=viewport, reduced_motion="reduce", accept_downloads=True)
        ctx.route(INTAKE + "/**", self.intake.handle)
        page = ctx.new_page()
        page.set_default_timeout(TIMEOUT_MS)
        page.on("pageerror", lambda e: self.errors.append(f"{path}: {e}"))
        page.on("console", lambda m: self.errors.append(f"{path}: {m.text}") if m.type == "error" and not expected(m) else None)
        page.goto(self.base + path)
        return page

    def home(self, path="/", viewport=DESKTOP):
        page = self.open(path, viewport)
        page.wait_for_selector("#packs .card", state="attached")
        return page


PREVIEW = 4   # missions per pack in "Every pack" with no filters (PACK_PREVIEW in site/js/browse.js)
FOLD_MIN = 20   # packs with fewer live missions fold under "More packs" (PACK_FOLD_MIN in site/js/browse.js)


def t_home_shows_a_taste_of_every_pack(site, catalog):
    page = site.home()
    packs = [p for p in catalog["packs"] if p["count"]]
    assert page.locator("#packs .pack.preview").count() == len(packs)
    assert page.locator("#packs .card").count() == sum(min(PREVIEW, p["count"]) for p in packs)
    big = [p for p in packs if p["count"] > PREVIEW]
    assert page.locator("#packs .pack-more").count() == len(big), "only packs with more than a row get a Show all link"
    p = max(big, key=lambda x: x["count"])
    more = page.locator(f'#packs .pack-more[href="/packs/{p["id"]}/"]')
    assert more.inner_text().startswith(f'{p["count"] - PREVIEW} more · Show all {p["count"]}')
    first = sorted((m for m in catalog["missions"] if m["pack"] == p["id"]), key=lambda m: m["number"])[:PREVIEW]
    section = page.locator(f'#packs .pack[aria-label="{p["name"]}"]')
    assert section.locator(".card h4").all_inner_texts() == [m["name"] for m in first], "the first missions by number"
    assert f"{len(catalog['missions'])} live missions" in page.inner_text("#browse-count")
    page.select_option("#browse-pack", p["id"])   # one pack on its own: all of it, no Show all link
    assert page.locator("#packs .card").count() == p["count"]
    assert page.locator("#packs .pack-more").count() == 0
    page.goto(site.base + f'/packs/{p["id"]}/')     # and the Show all page lists every mission in the pack
    assert page.locator(".cards .card").count() == p["count"]


def t_small_packs_fold_under_more_packs(site, catalog):
    packs = [p for p in catalog["packs"] if p["count"]]
    is_big = lambda p: p["id"] == "anywhere" or p["count"] >= FOLD_MIN
    lead = [p["name"] for p in sorted((p for p in packs if is_big(p)), key=lambda p: (p["id"] != "anywhere", -p["count"]))]
    small = [p for p in packs if not is_big(p)]
    for path, root in (("/", "#packs"), ("/missions/", ".page")):
        page = site.home() if path == "/" else site.open(path)
        shown = page.locator(f"{root} > section.pack").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
        assert shown == lead, f"{path}: Amble Anywhere, then the big packs, biggest first"
        fold = page.locator(f"{root} details.more-packs")
        assert fold.locator("section.pack").count() == len(small)
        assert f"{len(small)} more packs" in fold.locator("summary").inner_text()
        assert not fold.locator("section.pack").first.is_visible(), f"{path}: small packs stay folded until asked for"
        fold.locator("summary").click()
        assert fold.locator("section.pack").first.is_visible()
    page = site.home()
    page.click("#packs details.more-packs summary")
    page.check('input[name="mode"][value="date"]', force=True)   # a mood is picked: every match shows, nothing folded
    assert page.locator("#packs details.more-packs").count() == 0
    page.check('input[name="mode"][value="any"]', force=True)
    assert page.locator("#packs details.more-packs").get_attribute("open") is not None, "the fold stays the way you left it"


def t_phone_packs_swipe_sideways(site, catalog):
    page = site.home(viewport=PHONE)
    row = page.locator("#packs .pack.preview:has(.pack-more) .cards").first
    row.scroll_into_view_if_needed()
    assert row.evaluate("r => getComputedStyle(r).overflowX") == "auto"
    assert row.evaluate("r => r.scrollWidth > r.clientWidth + 50"), "the row should be wider than the screen"
    assert page.evaluate("document.scrollingElement.scrollWidth <= innerWidth"), "the page itself must not scroll sideways"


def t_picker_comes_before_the_story(site, catalog):
    page = site.home()
    roll = page.locator(".roll h1").bounding_box()["y"]
    assert roll < page.locator("#about").bounding_box()["y"]
    assert roll < DESKTOP["height"] / 2


def t_refreshing_your_mission_keeps_it_yours(site, catalog):
    page = site.home()
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    page.reload()
    page.wait_for_selector("#reveal-title")
    assert page.inner_text("#reveal-kicker") == "Your mission"
    assert page.locator("#reveal-slot .env").count() == 0


def t_skip_link_keeps_the_mission_open(site, catalog):
    page = site.home()
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    before = page.url
    page.evaluate("document.querySelector('.skip').click()")
    assert page.url == before and page.is_visible("#reveal-title")


def t_bad_links_get_a_letter(site, catalog):
    for path in ("/#mission=amblebee/not-a-mission", "/#mission=%E0%A4%A", "/#gift=1garbage"):
        page = site.open(path)
        page.wait_for_selector("text=This letter got lost in the mail.")


def t_filters_narrow_the_list_and_clear(site, catalog):
    page = site.home()
    taste = page.locator("#packs .card").count()
    page.click("#filters-toggle")
    page.click('[data-filter="cost"] label:has(input[value="free"])')
    free = sum(1 for m in catalog["missions"] if m["cost"] == "free")
    assert page.locator("#packs .card").count() == free, "with a filter on, every match shows, not a taste"
    assert page.locator("#packs .pack-more").count() == 0
    assert "fit your filters" in page.inner_text("#browse-count")
    page.click("#browse-clear")
    assert page.locator("#packs .card").count() == taste


def t_search_matches_words_and_typos(site, catalog):
    page = site.home()

    def search(text):
        page.fill("#search-input", text)
        page.wait_for_function("t => document.querySelector('#browse-count').textContent.includes(t)", arg=text)
        return page.locator("#packs .card h4").all_inner_texts()

    assert not any("Farmers Market" in n for n in search("sea"))
    assert search("watterfall")
    assert "close match" in page.inner_text("#browse-count")
    assert search("picnics") == search("picnic")


def t_search_reaches_past_distance_and_filters(site, catalog):
    page = site.home()
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")

    def search(text):
        page.fill("#search-input", text)
        page.wait_for_function("t => document.querySelector('#browse-count').textContent.includes(t)", arg=text)

    search("crater lake")
    far = page.locator("#packs .pack.beyond")
    assert "Crater Lake" in far.locator(".card h4").all_inner_texts(), "a place past the distance still turns up in search"
    assert "Farther than" in far.locator("h3").inner_text()
    assert far.locator(".card .d").count(), "and its card says how far away it is"
    search("multnomah")
    assert page.locator("#packs .pack.beyond").count() == 0, "a nearby match needs no second list"
    assert "Multnomah Falls" in page.locator("#packs .card h4").all_inner_texts()
    page.click(".zip-clear")
    page.click("#filters-toggle")
    page.check('[data-filter="cost"] input[value="free"]', force=True)
    search("symphony")
    assert "Outside your filters" in page.locator("#packs .pack.beyond h3").inner_text()
    page.click("#browse-clear")
    search("symphony")
    assert page.locator("#packs .pack.beyond").count() == 0 and page.locator("#packs .card").count()


def t_a_pick_without_a_zip_offers_real_places(site, catalog):
    page = site.home()
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert page.is_visible("#reveal-near"), "no ZIP yet: the pick says how to get real places"
    page.click("#reveal-near-btn")
    page.wait_for_function("() => document.activeElement && document.activeElement.id === 'zip-input'")
    assert not page.is_visible("#reveal")
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert not page.is_visible("#reveal-near"), "with a ZIP set there's nothing to nudge"


def t_zip_prefers_nearby_places(site, catalog):
    page = site.home()
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")
    page.evaluate("Math.random = () => 0")
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert page.is_visible(".place .dist"), "with a ZIP set, this pick should be a nearby place"


def t_note_card_survives_and_seals(site, catalog):
    page = site.home()
    page.click("#packs .card")
    page.click('#dialog-body button:has-text("Share this mission")')
    page.fill(".gc-to", "Sam")
    page.fill(".gc-from", "Alex")
    page.fill(".gc-note", "Pack a jacket")
    page.mouse.click(5, 5)   # a tap on the dim area
    assert page.is_visible(".gc-note"), "a card with writing on it must stay open"
    page.click("#gift-dialog .x-close")
    page.click('#dialog-body button:has-text("Share this mission")')
    assert page.input_value(".gc-note") == "Pack a jacket"
    page.click('.gift-form button[type="submit"]')
    page.wait_for_selector(".gift-link")
    link = page.input_value(".gift-link")

    opened = site.open(link.replace(site.base, ""))
    opened.wait_for_selector("text=Alex sent you a mission.")
    opened.click(".env-open")
    opened.wait_for_selector(".gift-body")
    assert opened.inner_text(".gift-body") == "Pack a jacket"


def t_sealed_letter_stays_sealed_with_a_remembered_zip(site, catalog):
    page = site.home()
    page.click("#packs .card")
    page.click('#dialog-body button:has-text("Share this mission")')
    page.fill(".gc-to", "Sam")
    page.fill(".gc-from", "Alex")
    page.click('button:has-text("Seal it")')
    page.wait_for_selector(".gift-link")
    link = page.input_value(".gift-link").replace(site.base, "")
    page.goto(site.base + "/contact/")   # a different page, so the link below is a fresh start
    page.evaluate("localStorage.setItem('amble.zip', '97201')")
    page.goto(site.base + link)
    page.wait_for_selector(".env-open")
    page.wait_for_function("() => S.here")
    assert page.is_visible(".env-open"), "the letter must wait for its Open button"
    page.click(".env-open")
    page.wait_for_selector("#reveal-title")


def t_back_closes_the_card(site, catalog):
    page = site.home()
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    page.click('#reveal-actions button:has-text("Share this mission")')
    page.fill(".gc-note", "Pack a jacket")
    page.go_back()
    page.wait_for_selector("#gift-dialog", state="hidden")
    assert page.is_visible("#roll-btn")


def t_no_places_nearby_says_so_and_offers_more(site, catalog):
    page = site.home()
    page.fill("#zip-input", "59001")
    page.click("#zip-form button")
    page.wait_for_selector("text=Nothing within 30 mi of 59001 yet.")
    assert "No places within 30 mi" in page.inner_text("#match-count")
    anywhere = sum(1 for m in catalog["missions"] if m["pack"] == "anywhere")
    assert page.locator("#packs .card").count() == anywhere, "do-anywhere missions still show"
    page.click(".near-widen")
    page.wait_for_selector("#packs .card .meta .d")
    assert page.locator("text=Nothing within").count() == 0


def t_popup_locks_the_page_behind_it(site, catalog):
    page = site.home(viewport=PHONE)
    page.locator("#packs .card").first.scroll_into_view_if_needed()
    page.locator("#packs .card").first.click()
    assert page.evaluate("getComputedStyle(document.documentElement).overflowY") == "hidden"


def t_saving_an_image_downloads_it(site, catalog):
    page = site.home()
    page.click("#packs .card")
    with page.expect_download() as download:
        page.click('#dialog-body button:has-text("Save as image")')
    assert download.value.suggested_filename.endswith(".png")


def t_phone_shows_the_main_button_first(site, catalog):
    page = site.home(viewport=PHONE)
    box = page.locator("#roll-btn").bounding_box()
    assert box["y"] + box["height"] <= PHONE["height"]
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")


def t_who_is_coming_widens_keeps_kids_safe_and_skips_romantic(site, catalog):
    page = site.home()
    page.select_option("#pack-select", "all")
    page.click("#filters-toggle")

    def fits():
        return page.evaluate("pool().map((m) => m.full_id)")

    def pick(who):
        page.click(f'[data-filter="who"] label:has(input[value="{who}"])')

    pick("friends")
    friends = fits()
    pick("family")
    both = fits()
    assert len(both) >= len(friends), "picking more people should never narrow the results"
    pick("friends")
    family = fits()
    by_id = {m["full_id"]: m for m in catalog["missions"]}
    assert any(by_id[i]["mode"] in ("adventure", "both") for i in family), "family should still get adventures"
    assert not any("romantic" in (by_id[i].get("themes") or []) or by_id[i]["mode"] == "date" for i in both)
    pick("friends")
    pick("family")
    pick("kids")
    kids = fits()
    assert kids, "friends + kids should find missions"
    assert all("kids" in (by_id[i].get("who") or []) for i in kids), "with Kids picked, every mission must welcome kids"
    assert not any("drinks" in (by_id[i].get("themes") or []) for i in kids)
    assert not any(by_id[i]["id"] in ("saluti-cellars-highland-cattle", "exploratorium-after-dark") for i in kids)
    pick("kids")
    pick("friends")
    pick("family")
    page.check('input[name="mode"][value="adventure"]', force=True)
    assert fits(), "family + adventure should find missions"


def t_cards_are_links_with_real_addresses(site, catalog):
    page = site.home()
    card = page.locator("#packs .card").first
    href = card.get_attribute("href")
    assert re.fullmatch(r"/missions/[a-z0-9-]+/", href), href
    card.click()
    page.wait_for_selector("#mission-dialog[open]")
    assert page.url.endswith(href)
    page.go_back()
    page.wait_for_selector("#mission-dialog", state="hidden")
    assert not page.url.endswith(href)
    card.click()
    page.wait_for_selector("#mission-dialog[open]")
    page.click("#mission-dialog .x-close")
    page.wait_for_url(lambda u: not u.endswith(href))
    card.click()
    page.reload()
    page.wait_for_selector(".ticket h1")


def t_popup_links_to_the_full_page(site, catalog):
    page = site.home()
    page.click("#packs .card")
    link = page.locator('#dialog-body a.full-page')
    href = link.get_attribute("href")
    assert re.fullmatch(r"/missions/[a-z0-9-]+/", href), href
    link.click()
    page.wait_for_selector(".page .ticket h1")
    assert page.url.endswith(href)
    assert page.locator(".page a.full-page").count() == 0, "no full-page button on the full page itself"


def t_share_without_a_note_is_the_mission_page(site, catalog):
    page = site.home()
    page.click("#packs .card")
    title = page.inner_text("#dialog-body h1, #dialog-body h2")
    page.click('#dialog-body button:has-text("Share this mission")')
    page.click('button:has-text("Share without a note")')
    page.wait_for_selector(".gift-link")
    link = page.input_value(".gift-link")
    assert re.search(r":\d+/missions/[a-z0-9-]+/$", link), "a plain link to the mission's own page, so chats show its preview"
    page.goto(link)
    assert page.inner_text("h1").strip() == title.strip()


def t_mission_page_shares_in_one_click(site, catalog):
    mission = catalog["missions"][0]
    path = f"/missions/{mission['id']}/"
    page = site.open(path)
    page.click('a:has-text("Share this mission")')              # the card writer opens straight away
    page.wait_for_selector(".gc-note")
    assert "do=card" not in page.url, "refreshing shouldn't open the card writer again"
    page = site.open(path)
    with page.expect_download() as saved:                       # and Save as image saves in one click
        page.click('a:has-text("Save as image")')
    assert saved.value.suggested_filename.endswith(".png")


def t_zero_results_offer_a_way_out(site, catalog):
    page = site.home()
    page.select_option("#pack-select", "all")
    page.click("#filters-toggle")
    for chip in ('[data-filter="effort"] label:has(input[value="hard"])', '[data-filter="cost"] label:has(input[value="free"])',
                 '[data-filter="setting"] label:has(input[value="indoor"])'):
        page.click(chip)
    page.wait_for_selector("text=Nothing matches, yet.")
    assert "would open up" in page.inner_text(".env-sub")
    page.click('#ticket-slot button:has-text("Clear all")')
    assert page.locator(".env-title:has-text('Nothing matches')").count() == 0


def t_zip_can_be_remembered_and_units_keep_distance(site, catalog):
    page = site.home()
    page.fill("#zip-input", "12")
    page.click("#zip-form button")
    page.wait_for_selector("text=A ZIP code is 5 numbers")
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")
    assert page.input_value("#within-select") == "30"
    page.click('.units button[data-unit="km"]')
    assert page.input_value("#within-select") == "50"
    page.click('.units button[data-unit="mi"]')
    page.click("text=Remember on this device")
    page.reload()
    page.wait_for_selector(".zip-set")
    page.click(".zip-clear")
    page.reload()
    page.wait_for_selector("#packs .card", state="attached")
    assert page.locator(".zip-set").count() == 0


def t_mission_view_has_its_own_title_and_heading(site, catalog):
    page = site.home()
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert page.title().startswith(page.inner_text("#reveal-title"))
    assert page.evaluate("document.querySelector('#reveal-title').tagName") == "H1"
    page.click('#reveal-actions button:has-text("Start over")')
    page.wait_for_selector("#roll-btn")
    assert page.title() == "AmbleBee: Date Ideas and Adventures Near You"


def t_search_results_are_announced(site, catalog):
    page = site.home()
    page.fill("#search-input", "museum")
    page.wait_for_function("() => document.querySelector('#live').textContent.includes('museum')")


def t_files_have_versions_and_404_is_branded(site, catalog):
    page = site.open("/404.html")
    assert "doesn't go anywhere" in page.inner_text("h1")
    page = site.home()
    assert page.locator('script[src*="js/core.js?v="]').count() == 1
    assert page.locator('link[href*="style.css?v="]').count() == 1


def t_time_of_day_filter_keeps_any_time_missions(site, catalog):
    page = site.home()
    page.select_option("#pack-select", "all")
    page.click("#filters-toggle")
    page.click('[data-filter="time"] label:has(input[value="night"])')
    picks = page.evaluate("pool().map((m) => m.time_of_day)")
    assert picks and set(picks) <= {"night", "any"}


def t_city_search_and_location(site, catalog):
    page = site.home()
    page.fill("#zip-input", "Portland, OR")
    page.click("#zip-form button")
    page.wait_for_selector("text=Near Portland, OR")
    page.click(".zip-clear")
    page.fill("#zip-input", "Portland")
    page.click("#zip-form button")
    page.wait_for_selector("#zip-status >> text=Portland, ME")
    page.click("#zip-status >> text=Portland, ME")
    page.wait_for_selector("text=Near Portland, ME")
    page.click(".zip-clear")
    page.fill("#zip-input", "Notarealplacehere")
    page.click("#zip-form button")
    page.wait_for_selector("text=Couldn't find Notarealplacehere")
    page.context.grant_permissions(["geolocation"])
    page.context.set_geolocation({"latitude": 45.52, "longitude": -122.68})
    page.click("#use-location")
    page.wait_for_selector("text=Near 972")
    assert "lat" not in page.url and "45." not in page.url
    assert page.locator('text="Remember on this device"').count() == 0
    page.fill("#zip-input", "97201")             # a ZIP typed by hand can be saved again
    page.click("#zip-form button")
    page.wait_for_selector('text="Remember on this device"')


def t_shared_city_names_list_the_likely_one_first(site, catalog):
    page = site.home()
    page.fill("#zip-input", "Albany")
    page.click("#zip-form button")
    page.wait_for_selector("#zip-status >> text=Albany, NY")
    assert page.locator("#zip-status button").first.inner_text() == "Albany, NY"
    page.fill("#zip-input", "Pasadena")
    page.click("#zip-form button")
    page.wait_for_selector("#zip-status >> text=Pasadena, CA")
    assert page.locator("text=Not listed?").count() == 0
    page.fill("#zip-input", "Springfield")
    page.click("#zip-form button")
    page.wait_for_selector("text=Not listed? Add the state")
    assert page.locator("#zip-status button").count() == 6


def t_location_shows_the_closest_zip(site, catalog):
    def locate(lat, lon, page=None):
        page = page or site.home()
        page.context.grant_permissions(["geolocation"])
        page.context.set_geolocation({"latitude": lat, "longitude": lon})
        page.click("#use-location")
        return page

    page = locate(45.52, -122.68)
    page.wait_for_selector("text=Near 972")      # set by itself, no pressing Set
    zip_code = page.input_value("#zip-input")
    assert re.fullmatch(r"972\d\d", zip_code), zip_code
    assert page.input_value("#within-select") == "30", "the distance should already be picked"
    assert page.evaluate("S.here.lat") == 45.52, "distances should keep using the exact location"
    assert zip_code not in page.url
    assert page.evaluate("Object.values(localStorage).join()").find(zip_code) < 0, "a location must never be saved"

    page.fill("#zip-input", "10001")             # came back to "any distance", then asked again
    page.click("#zip-form button")
    page.wait_for_selector("text=Near 10001")
    page.select_option("#within-select", "")
    locate(45.52, -122.68, page)
    page.wait_for_selector("text=Near 972")
    assert page.input_value("#within-select") == "30"

    page = locate(51.5, -0.12)   # London: no ZIP anywhere close
    page.wait_for_selector("text=Near your location")
    page.wait_for_function("() => S.zips")
    assert page.input_value("#zip-input") == ""
    assert page.input_value("#within-select") == "30"


def t_filters_survive_in_the_address(site, catalog):
    page = site.home()
    page.select_option("#pack-select", "all")
    page.click("#filters-toggle")
    page.click('[data-filter="cost"] label:has(input[value="free"])')
    page.fill("#search-input", "waterfall")
    page.wait_for_function("() => location.search.includes('q=waterfall')")
    url = page.url
    assert "cost=free" in url
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")
    assert "97201" not in page.url, "a location must never go in the address"
    other = site.home(url.replace(site.base, ""))
    assert other.input_value("#search-input") == "waterfall"
    assert other.is_checked('[data-filter="cost"] input[value="free"]')
    assert other.input_value("#pack-select") == "all"
    assert 0 < other.locator("#packs .card").count() < len(catalog["missions"])
    assert other.is_visible("#browse-share")


def t_sort_makes_one_ordered_list(site, catalog):
    page = site.home()
    page.select_option("#browse-sort", "cost")
    costs = page.locator("#packs .card .meta span:last-child").all_inner_texts()
    order = ["Free", "Under $20", "$20-60", "Over $60"]
    assert [order.index(c) for c in costs] == sorted(order.index(c) for c in costs)
    assert page.locator("#packs .pack-head").count() == 0
    assert "sort=cost" in page.url
    assert page.locator('#browse-sort option[value="distance"]').count() == 0
    page.fill("#zip-input", "97201")
    page.click("#zip-form button")
    page.wait_for_selector(".zip-set")
    page.select_option("#browse-sort", "distance")
    assert "mi" in page.locator("#packs .card .meta .d").first.inner_text()


def t_phone_menu_reaches_everything_from_any_page(site, catalog):
    mission = catalog["missions"][0]
    for path in ("/", "/roadmap.html", f"/missions/{mission['id']}/", "/contact/"):
        page = site.open(path, PHONE)
        page.click(".top .menu summary")
        for text in ("Every mission", "Search", "About", "Bee trail", "Contribute", "Safety", "Privacy", "Contact"):
            assert page.locator(".menu-panel a", has_text=text).first.is_visible(), f"{text} missing on {path}"
        page.keyboard.press("Escape")
        assert not page.is_visible(".menu-panel")
        assert page.is_visible('.top nav > a.nav-profile[href="/me/"]'), f"Profile is one tap away on a phone ({path})"
        assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page = site.home(viewport=PHONE)
    page.click(".top .menu summary")
    page.locator(".menu-panel a", has_text="Safety").click()
    page.wait_for_url("**/safety/")


def t_computer_menu_and_search_link(site, catalog):
    page = site.home()
    assert page.is_visible('.top nav > a:has-text("Bee trail")')
    page.click(".top .menu summary")
    assert page.is_visible('.menu-panel a:has-text("Privacy")')
    assert not page.is_visible('.menu-panel a:has-text("Bee trail")')
    page.mouse.click(5, 400)
    assert not page.is_visible(".menu-panel")
    page.click('.top nav > a[href="/#search"]')
    page.wait_for_function("() => document.activeElement.id === 'search-input'")
    assert page.locator(".top .brand img[src*='logo.webp']").evaluate("i => i.complete && i.naturalWidth > 0"), "the logo loads"
    assert page.locator('.menu-panel a[href="/me/"]').count() == 0, "Your missions moved out of More"
    profile = page.locator('.top nav > a.nav-profile')
    assert profile.is_visible() and profile.evaluate("a => a.previousElementSibling.textContent") == "Contribute", \
        "Profile sits right of Contribute"
    page.click('.top nav > a:has-text("Contribute")')
    page.wait_for_url("**/contribute/")
    page.get_by_role("link", name="Profile").click()     # opens the profile menu (site/nav.js)
    page.locator("#profile-menu a", has_text="My stamps and missions").click()
    page.wait_for_url("**/me/")
    assert page.locator('.nav-profile[aria-current="page"]').count() == 1
    page.goto(site.base + "/me/settings/")
    assert page.locator('.nav-profile[aria-current="page"]').count() == 1
    assert page.locator(".top .brand img[src='/logo.webp']").evaluate("i => i.complete && i.naturalWidth > 0"), "and on other pages"


def t_menu_links_keep_filters_and_leave_a_mission(site, catalog):
    page = site.home("/?cost=free")
    page.click('.top nav > a[href="/#browse"]')
    assert "cost=free" in page.url
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    page.click('.top nav > a[href="/#browse"]')
    page.wait_for_selector("#browse", state="visible")


def t_footer_is_dark_on_short_pages_too(site, catalog):
    page = site.open("/contact/", {"width": 1280, "height": 1600})
    box = page.locator(".foot").bounding_box()
    assert box["y"] + box["height"] >= 1599, "the footer should reach the bottom of a short page"
    assert page.evaluate("getComputedStyle(document.querySelector('.foot')).backgroundColor") == "rgb(74, 51, 35)"
    for path in ("/contact/", "/", "/roadmap.html"):      # Follow along: the AmbleBeeHQ accounts, in a new tab
        social = site.open(path).locator(".foot .foot-social a")
        assert social.count() == 3, f"{path}: the footer should link Pinterest, Bluesky and X"
        for i in range(3):
            link = social.nth(i)
            assert link.get_attribute("target") == "_blank" and "AmbleBee on" in (link.get_attribute("aria-label") or "")


def t_idea_pages_gather_missions_and_link_both_ways(site, catalog):
    kids = [m for m in catalog["missions"] if "kids" in (m.get("who") or [])]
    page = site.home()
    assert page.title().startswith("AmbleBee: Date Ideas"), "the home page has a searchable title"
    page.locator("#browse .ideas a[href='/kid-friendly-adventures/']").click()   # Browse by idea, from home
    page.wait_for_selector("h1")
    assert page.inner_text("h1") == "Kid-Friendly Adventures"
    assert page.locator(".card").count() == len(kids)
    assert f"{len(kids)} ideas" in page.inner_text("main")
    assert page.locator(".ideas-more a[href='/kid-friendly-adventures/']").count() == 0, "no link to itself"
    page = site.open(f"/missions/{kids[0]['id']}/")                                 # and back from the mission
    assert page.locator(".also-in a[href='/kid-friendly-adventures/']").count() == 1
    page = site.open("/missions/")
    assert page.locator(".ideas a").count() >= 4
    page = site.home()
    page.locator("#packs .card").first.click()                                     # leaving a mission restores the title
    page.go_back()
    page.wait_for_function("document.title.startsWith('AmbleBee: Date Ideas')")


def t_faq_questions_open_and_search_filters_them(site, catalog):
    page = site.open("/faq/")
    page.wait_for_selector(".faq-search", state="visible")
    total = page.locator(".faq-item").count()
    assert total >= 10 and page.locator(".faq-item[open]").count() == 0, "every question starts closed"
    page.click("#cost summary")
    assert page.locator("#cost[open]").count() == 1 and page.is_visible("#cost .faq-a"), "clicking a question opens its answer"
    page.fill("#faq-q", "credit")
    assert page.locator(".faq-item:not([hidden])").count() == 1 and page.locator("#credit[open]").count() == 1
    assert "1 answer matches" in page.inner_text(".faq-count")
    assert not page.is_visible("#using"), "a section with no matches is hidden"
    page.fill("#faq-q", "price")   # a word that's not in the text, only in its extra search words
    assert page.locator("#cost:not([hidden])").count() == 1
    page.fill("#faq-q", "Don’t hear")   # a curly apostrophe still matches "don't"
    assert page.locator("#reply:not([hidden])").count() == 1
    page.fill("#faq-q", "del")          # half a word is enough
    assert page.locator("#delete:not([hidden])").count() == 1
    page.fill("#faq-q", "zzzz")
    assert page.locator(".faq-item:not([hidden])").count() == 0 and page.is_visible(".faq-none") and "zzzz" in page.inner_text(".faq-none")
    page.press("#faq-q", "Escape")
    assert page.locator(".faq-item:not([hidden])").count() == total and not page.is_visible(".faq-none")
    assert page.locator("#cost[open]").count() == 1 and page.locator("#credit[open]").count() == 0, "clearing puts back what was open"
    page = site.open("/faq/#statuses")
    page.wait_for_selector("#statuses[open]")
    assert "Working on it" in page.inner_text("#statuses .faq-a"), "a link to one answer opens it"
    page = site.open("/faq/?q=delete")
    page.wait_for_selector("#delete[open]")
    assert page.input_value("#faq-q") == "delete"


def t_built_pages_load(site, catalog):
    mission = catalog["missions"][-1]
    for path in ("/roadmap.html", "/missions/", f"/packs/{mission['pack']}/", f"/missions/{mission['id']}/",
                 "/about/", "/safety/", "/privacy/", "/faq/", "/contact/", "/rainy-day-date-ideas/", "/at-home-date-ideas/",
                 "/free-date-ideas/", "/kid-friendly-adventures/"):
        page = site.open(path)
        page.wait_for_selector("h1")
    page = site.open("/faq/")
    data = json.loads(page.inner_text('script[type="application/ld+json"]'))
    assert data["@type"] == "FAQPage" and len(data["mainEntity"]) >= 10, "the FAQ is marked up for search"
    assert page.locator('nav .menu-panel a[href="/faq/"]').count() == 1, "the FAQ is in the More menu"
    assert site.open("/contact/").locator('a[href="/faq/"]').count() >= 1, "the contact page points to the FAQ"
    page = site.open(f"/missions/{mission['id']}/")
    assert mission["name"] in page.inner_text("h1")
    assert all("about" not in m for m in catalog["missions"]), "a mission's about is for its web page, never catalog.json"
    sys.path.insert(0, str(ROOT / "tools"))
    from missions_lib import load_catalog
    live_ids = {m["id"] for m in catalog["missions"]}
    with_about = next((m for m in load_catalog(ROOT / "missions")[2] if m.get("about") and m["id"] in live_ids), None)
    if with_about:   # ...but it does show on the mission's own page
        about = site.open(f"/missions/{with_about['id']}/").locator(".mission-about")
        assert about.count() == 1 and about.locator("p").count() >= 1, "the about text should show on the mission page"
        assert about.locator(".about-icon svg").count() == 1, "the about card has its open-book badge"
    linked = next(((m, t) for m in load_catalog(ROOT / "missions")[2] if m["id"] in live_ids
                   for t in re.findall(r"\[\[([a-z0-9-]+)\]\]", str(m.get("about") or "")) if t in live_ids), None)
    if linked:   # [[mission-id]] in an about becomes a link to that mission, showing its name
        m, target = linked
        link = site.open(f"/missions/{m['id']}/").locator(f'.mission-about a[href="/missions/{target}/"]')
        name = next(x["name"] for x in catalog["missions"] if x["id"] == target)
        assert link.count() >= 1 and link.first.inner_text() == name
    page = site.open(f"/missions/{mission['id']}/")
    welcome = page.locator(".welcome")   # first-time visitors from Google learn what AmbleBee is
    assert "New to AmbleBee?" in welcome.inner_text() and welcome.locator('a[href="/"]').count() == 1
    assert welcome.locator(".ideas a").count() >= 1
    page.evaluate("localStorage.setItem('amble.used', '1')")      # opened a mission before: no intro
    page.reload()
    assert page.locator(".welcome").count() == 0, "returning visitors shouldn't see the New to AmbleBee box"
    page = site.open(f"/missions/{mission['id']}/")
    for _ in range(3):                                            # a few pages in, without opening a mission
        page.reload()
    assert page.locator(".welcome").count() == 0, "the intro should go after a few pages"
    raw = page.evaluate("fetch(location.href).then((r) => r.text())")
    assert "New to AmbleBee?" in raw, "search engines still get the box in the page itself"
    checked = next((m for m in catalog["missions"] if m.get("checked")), None)
    if checked:   # the "Checked November 2026" line, on the mission's page and in the popup
        page = site.open(f"/missions/{checked['id']}/")
        assert re.match(r"Checked [A-Z][a-z]+ 20\d\d$", page.inner_text(".ticket .checked").strip())
        page = site.home()
        page.goto(site.base + "/#mission=" + checked["full_id"].replace("/", "%2F") + "&from=page")
        page.wait_for_selector("#reveal-title")
        assert page.inner_text(".ticket .checked").strip() == site.open(f"/missions/{checked['id']}/").inner_text(".ticket .checked").strip()
    page = site.open(f"/missions/{mission['id']}/")
    for path in (f"/missions/{mission['id']}/", f"/packs/{mission['pack']}/", "/free-date-ideas/", "/about/", "/roadmap.html"):   # each has its share card
        card = site.open(path).get_attribute('meta[property="og:image"]', "content")
        assert "/cards/" in card and "?v=" in card, f"{path} has no share card of its own"
        r = page.request.get(site.base + card.split("amblebee.com", 1)[1])
        assert r.ok and r.headers["content-type"] == "image/png", f"{path}: its share card is missing"
    assert page.locator(".report a").count() == 1
    assert page.locator("a[href^='mailto:']").count() == 0
    page = site.open("/contact/")
    assert page.locator("a[href='mailto:staff@amblebee.com']").count() >= 1, "email stays as the fallback"


def t_suggest_page_offers_both_ways(site, catalog):
    # old /suggest/ links land on Contribute. A plain page: the instant redirect cuts off the font downloads,
    # which Firefox reports as errors, so the redirect is checked without collecting page errors
    old = site.browser.new_page()
    old.goto(site.base + "/suggest/")
    old.wait_for_url(re.compile(r".*/contribute/#suggest$"))
    old.close()
    page = site.open("/contribute/")
    assert page.locator(".suggest-paths a[href='/suggest/idea/']").count() == 1
    assert page.locator(".suggest-paths a[href='/suggest/mission/']").count() == 1
    text = page.inner_text(".suggest-paths")
    assert "takes us longer" in text and "helps us the most" in text, "each way says what it means for us"


def t_suggest_form_sends_and_keeps_the_status_link(site, catalog):
    page = site.open("/suggest/idea/")
    page.wait_for_selector(".intake-form", state="visible")
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector(".intake-form .err")
    assert page.get_attribute("#idea-title", "aria-invalid") == "true", "a missing title is pointed out"
    page.fill("#idea-title", "Tide pools at Haystack Rock")
    page.fill("#idea-body", "Go at low tide and find three different sea stars.")
    assert "first name and last initial" in page.inner_text("#idea-name-hint").lower()
    page.fill("#idea-name", "sam rivera")
    page.check("input[name=credit]")
    assert page.input_value("#idea-name") == "Sam R.", "a full name is shortened to a first name and last initial"
    page.fill("#idea-email", "sam@example.com")
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector(".intake-done .link-box")
    note = page.inner_text(".intake-done .spam-note")
    assert "sam@example.com" in note and "spam folder" in note, "the thank-you says where the email went"
    assert page.input_value(".intake-done .link-box") == "https://amblebee.com/status/#tok123"
    path, sent = site.intake.posts[-1]
    assert path == "/submit/idea" and sent["credit"] is True and sent["website"] == "" and sent["elapsed_ms"] > 0
    assert sent["name"] == "Sam R."
    page.reload()
    page.wait_for_selector(".intake-mine li a")
    assert page.inner_text(".intake-mine li a") == "Tide pools at Haystack Rock", "the link is kept under Your submissions"
    card = page.evaluate("(() => { const s = getComputedStyle(document.querySelector('.intake-mine')); return [s.boxShadow, s.paddingLeft]; })()")
    assert card[0] != "none" and card[1] != "0px", "Your submissions sits in a card"
    assert page.input_value("#idea-title") == "", "a sent suggestion doesn't come back as a draft"


def t_builder_walks_through_and_sends(site, catalog):
    page = site.open("/suggest/mission/", PHONE)
    page.wait_for_selector(".builder-panel h2")
    assert not page.locator(".builder-back").is_visible(), "no Back on the first step"
    page.click(".builder-next")                                        # nothing filled in: it says what's missing
    page.wait_for_selector(".builder-panel .err")
    page.select_option("#b-pack", "oregon")
    page.fill("#b-name", "Tide Pools at Haystack Rock")
    page.click("#b-mode label:has-text('Date or adventure')")
    page.click("#b-who label:has-text('kids')")
    page.click(".builder-next")
    page.wait_for_selector("#b-place_name")                             # Oregon needs a place
    page.click(".builder-next")
    page.wait_for_selector(".field[data-field=place_name] .err")
    page.fill("#b-place_name", "Haystack Rock")
    page.fill("#b-coords", "45.88456, -123.96875")
    assert "Right-click" in page.inner_text(".field[data-field=coords] .tip"), "each field has its tip"
    page.click(".builder-next")
    page.wait_for_selector("#b-short")
    page.fill("#b-short", "Find three kinds of sea stars at low tide.")
    page.fill("#b-description", "Go at low tide, hold hands and find three kinds of sea stars.")
    page.fill("#b-for_kids", "Find a crab hiding in the rocks!")
    page.fill("#b-kids_steps", "Something orange")
    page.click(".builder-next")
    page.wait_for_selector(".field[data-field=description] .err")      # couple words on a mission kids can come on
    page.fill("#b-description", "Go at low tide and find three kinds of sea stars, then photograph the biggest one with the rock behind it.")
    page.click(".builder-next")
    page.wait_for_selector("#b-duration")
    page.click("#b-gear-items label:has-text('headlamps')")
    page.select_option(".gear-row select", "on-site")
    page.click(".builder-next")
    page.wait_for_selector("#b-themes")
    page.click("#b-themes label:has-text('Beaches & coast')")
    page.click("#b-themes label:has-text('Wine, beer & cocktails')")
    page.click(".builder-next")
    page.wait_for_selector(".field[data-field=themes] .err")           # no drinks when kids can come
    page.click("#b-themes label:has-text('Wine, beer & cocktails')")
    page.click(".builder-next")
    page.wait_for_selector("#b-about")
    page.reload()                                                       # answers survive a reload, on the same step
    page.wait_for_selector("#b-about")
    page.click(".builder-next")
    page.fill("#b-email", "sam@example.com")
    page.click(".builder-next")
    page.wait_for_selector(".review-part")
    review = page.inner_text(".builder-panel")
    assert "Haystack Rock" in review and "headlamps" in review and "spam folder" in review
    page.click(".builder-next")                                         # Send my mission
    page.wait_for_selector(".intake-done .link-box")
    path, sent = site.intake.posts[-1]
    m = sent["mission"]
    assert path == "/submit/mission" and m["pack"] == "oregon" and m["who"] == ["kids"] and m["gear"] == [{"item": "headlamps", "rent": "on-site"}]
    assert m["themes"] == ["beach"] and m["season"] == "any" and m["place"]["coords"] == "45.88456, -123.96875" and sent["email"] == "sam@example.com"
    assert "spam folder" in page.inner_text(".intake-done .spam-note")
    page.goto(site.base + "/suggest/mission/")
    page.wait_for_selector(".builder-panel h2")
    assert page.input_value("#b-name") == "", "a sent mission doesn't come back as a draft"


def t_report_from_a_mission_fills_it_in(site, catalog):
    mission = catalog["missions"][0]
    page = site.open(f"/missions/{mission['id']}/")
    page.click(".report a")
    page.wait_for_selector(".intake-form", state="visible")
    assert mission["name"] in page.inner_text(".report-about"), "the report names its mission"
    page.fill("#report-body", "The parking lot is closed for the winter.")
    page.check("input[name=follow]")
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector(".intake-done .link-box")
    path, sent = site.intake.posts[-1]
    assert path == "/report" and sent["mission_id"] == mission["id"] and sent["follow"] is True
    ticket = site.home()
    ticket.click("#packs .card")
    href = ticket.get_attribute("#dialog-body .report a", "href")
    assert href.startswith("/report/?id="), "the pop-up ticket links to the report page too"


def t_contact_form_sends_and_keeps_a_draft(site, catalog):
    page = site.open("/contact/")
    page.wait_for_selector(".intake-form", state="visible")
    page.fill("#contact-name", "Riley")
    page.fill("#contact-message", "Any plans for a Montana pack?")
    page.reload()                                                     # typing survives a reload
    page.wait_for_selector(".intake-form", state="visible")
    assert page.input_value("#contact-message") == "Any plans for a Montana pack?"
    page.fill("#contact-email", "riley@example.com")
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector("#contact-subject[aria-invalid=true], .form-status.bad")   # the subject is required
    page.fill("#contact-subject", "A Montana pack?")
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector(".intake-done h2")
    assert "token" not in json.dumps(site.intake.posts[-1][1])
    assert page.input_value(".intake-done .link-box") == "https://amblebee.com/status/#msg123", "a private link to the conversation"
    assert "riley@example.com" in page.inner_text(".intake-done .spam-note") and "spam" in page.inner_text(".intake-done .spam-note")
    assert page.inner_text(".intake-mine li a") == "A Montana pack?" and "Message" in page.inner_text(".intake-mine li small")


def t_forms_say_when_the_mailbox_is_closed(site, catalog):
    site.intake.mode = "paused"                       # switched off on purpose: closed, and no backup
    for path in ("/suggest/idea/", "/suggest/mission/", "/report/", "/contact/"):
        page = site.open(path)
        page.wait_for_selector(".intake-down", state="visible")
        assert not page.is_visible(".intake-form, .builder-form") and not page.is_visible(".intake-backup"), f"{path} paused must stay closed"
    site.intake.mode = "down"                         # server unreachable: the Google Form backups
    for path in ("/suggest/idea/", "/suggest/mission/"):
        page = site.open(path)
        page.wait_for_selector(".intake-backup", state="visible")
        assert page.get_attribute(".backup-link", "href").startswith("https://forms.gle/"), path
    mission = catalog["missions"][0]
    page = site.open(f"/report/?id={mission['id']}&name={mission['name']}")
    page.wait_for_selector(".intake-backup", state="visible")
    href = page.get_attribute(".backup-link", "href")
    assert "docs.google.com/forms" in href and f"entry.872618061={mission['id']}" in href, "the backup report keeps the mission"
    page = site.open("/contact/")
    page.wait_for_selector(".intake-down", state="visible")   # contact has no Google Form: email instead
    site.intake.mode = "up"
    page = site.open("/suggest/idea/")
    site.intake.mode = "down"
    page.wait_for_selector(".intake-form", state="visible")
    page.fill("#idea-title", "Tide pools")
    page.fill("#idea-body", "Go at low tide and find three different sea stars.")
    page.click(".intake-form button[type=submit]")                # the server vanishes mid-send
    page.wait_for_selector(".form-status.bad a")
    assert "forms.gle" in page.get_attribute(".form-status.bad a", "href"), "a failed send offers the backup too"
    assert page.input_value("#idea-title") == "Tide pools", "and nothing typed is lost"
    site.intake.mode = "up"


def t_status_page_shows_where_it_is(site, catalog):
    page = site.open("/status/#tok123")
    page.wait_for_selector(".status-card")
    assert page.inner_text(".status-headline") == "In review"
    assert page.locator(".steps li.done").count() == 1 and page.locator(".steps li.now").count() == 1
    assert "Nov 12" in page.inner_text(".steps li.done") and "Nov 14" in page.inner_text(".steps li.now"), "each step reached shows its date"
    assert page.locator(".steps li:not(.done):not(.now) .step-date").count() == 0, "steps not reached yet have no date"
    assert "What's happened so far" in page.inner_text(".status-view") and page.locator(".status-history li").count() == 2
    assert "November 14, 2026" in page.inner_text(".status-history li:last-child")
    page = site.open("/status/#nope")
    page.wait_for_selector(".status-view h2")
    assert "couldn't find" in page.inner_text(".status-view h2")
    page = site.open("/status/")
    page.fill("#status-link", "https://amblebee.com/status/#tok123")
    page.click(".link-form button")
    page.wait_for_selector(".status-card")
    for path in ("/status/", "/report/"):
        assert site.open(path).locator('meta[name="robots"][content="noindex"]').count() == 1, f"{path} stays out of search"
    for path in ("/suggest/idea/", "/suggest/mission/"):
        assert site.open(path).locator('meta[name="robots"]').count() == 0, f"{path} can be found in search"


def t_status_page_shows_a_contact_conversation_and_takes_a_reply(site, catalog):
    page = site.open("/status/#msg123")
    page.wait_for_selector(".status-thread")
    assert page.inner_text(".status-headline") == "We wrote back"
    assert page.locator(".status-thread li").count() == 2 and page.locator(".status-thread li.us").count() == 1
    assert "Any favorite spots?" in page.inner_text(".status-thread li.us")
    hints = page.inner_text(".status-answer")
    assert "closes on December 13, 2026" in hints and "waiting to hear from you" in hints
    assert "not by email" in hints, "it says to reply here, not by email"
    page.fill("#status-answer", "Glacier, for sure.")
    page.click(".status-answer button[type=submit]")
    page.wait_for_selector(".status-thanks")
    assert site.intake.posts[-1] == ("/status/msg123/reply", {"message": "Glacier, for sure."})
    assert page.locator(".status-thread li").count() == 3 and "Glacier, for sure." in page.inner_text(".status-thread li:last-child")
    assert page.inner_text(".status-headline") == "Received"
    assert page.locator(".status-answer").count() == 1, "they can write again"
    del site.intake.thread[2:]


def t_a_contact_conversation_can_be_closed_from_the_page_or_an_email(site, catalog):
    site.intake.closed = False
    page = site.open("/status/#msg123")
    page.wait_for_selector(".status-close button")
    assert page.locator(".status-closeask").count() == 0, "no question unless the email's Close button was used"
    page.click(".status-close button")
    page.wait_for_function("() => document.querySelector('.status-headline') && document.querySelector('.status-headline').textContent === 'Closed'")
    assert site.intake.posts[-1][0] == "/status/msg123/close"
    assert "Closed. Thanks" in page.inner_text(".status-thanks")
    assert page.locator(".status-close").count() == 0 and page.locator(".status-answer").count() == 1, "closed, but they can still write"

    site.intake.closed = False   # the Close button in an email: the page asks first
    before = len(site.intake.posts)
    page = site.open("/status/#msg123&close")
    page.wait_for_selector(".status-closeask")
    assert len(site.intake.posts) == before and not site.intake.closed, "opening the link doesn't close anything by itself"
    assert page.locator(".status-thread li").count() == 2, "the conversation is there to read first"
    page.click(".status-closeask-actions button:has-text('Keep it open')")
    page.wait_for_selector(".status-close button")
    assert page.locator(".status-closeask").count() == 0 and not site.intake.closed
    assert page.evaluate("location.hash") == "#msg123", "the close request is dropped from the address"
    page = site.open("/status/#msg123&close")
    page.click(".status-closeask-actions button:has-text('Yes, close it')")
    page.wait_for_selector(".status-thanks")
    assert site.intake.closed and page.inner_text(".status-headline") == "Closed"
    assert page.evaluate("location.hash") == "#msg123"
    site.intake.closed = False


def t_status_page_asks_a_question_and_takes_the_answer(site, catalog):
    site.intake.answered = False
    page = site.open("/status/#ask123")
    page.wait_for_selector(".status-answer")
    assert page.inner_text(".status-headline") == "We have a question"
    assert page.inner_text(".status-question") == "Which bridge do you start at?"
    assert page.locator(".steps li.now").count() == 1 and page.inner_text(".steps li.now").startswith("working"), \
        "while a question waits, the progress steps still show where it'll go back to"
    assert "December 12, 2026" in page.inner_text(".status-answer .hint"), "it says when to answer by"
    page.click(".status-answer button[type=submit]")
    assert page.get_attribute("#status-answer", "aria-invalid") == "true", "an empty answer is pointed out"
    assert not site.intake.answered
    page.fill("#status-answer", "The red one on Mill Road.")
    page.click(".status-answer button[type=submit]")
    page.wait_for_selector(".status-thanks")
    assert site.intake.posts[-1] == ("/status/ask123/reply", {"message": "The red one on Mill Road."})
    assert page.inner_text(".status-headline") == "Working on it", "it carries on from where it was"
    assert page.locator(".status-answer").count() == 0, "the question is gone once it's answered"

# ---- Mark done, Your missions and backups (site/js/done.js, site/js/me.js) ----
def mark(page, within=""):
    """Press Mark done, and answer "Not now" if it asks "Start a free profile?" (after one Not now it stops asking)."""
    page.click((within + " " if within else "") + ".done-mark")
    if page.locator(".profile-dlg[open]").count():
        page.click(".profile-dlg .profile-later")
        page.wait_for_selector(".profile-dlg[open]", state="detached")


def give_profile(site, page):
    """This browser gets a profile on FakeIntake (Settings only shows its other sections with one). Reloads the page."""
    key = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(22))
    site.intake.profiles[key] = {"done": {}, "removed": [], "prefs": None, "email": False, "vault": {"wk": None, "we": None, "salt": None}}
    page.evaluate("k => localStorage.setItem('amble.profile', JSON.stringify({ key: k, since: null, email: false, last: 0 }))", key)
    page.reload()
    return key
def t_mark_done_keeps_the_mission_and_how_it_went(site, catalog):
    mission = catalog["missions"][0]
    path = f"/missions/{mission['id']}/"
    page = site.open(path)
    mark(page)
    assert "Done" in page.inner_text(".done-head")
    assert page.locator(".done-entry[open]").count() == 1, "the new chip opens, ready for how it went"
    assert page.evaluate("document.activeElement.closest('.done-entry') !== null")
    page.click('[data-rate="up"]')
    assert page.get_attribute('[data-rate="up"]', "aria-pressed") == "true"
    page.fill(".done-box textarea", "Best sandwich of the year.")
    page.locator(".done-box textarea").blur()
    page.reload()
    page.wait_for_selector(".done-head")
    assert page.locator(".done-entry[open]").count() == 0, "after a reload each time is a closed chip"
    summary = page.inner_text(".done-entry summary")
    assert summary.startswith("Done ") and "Loved it" in summary and "Note" in summary
    page.click(".done-entry summary")
    assert page.get_attribute('[data-rate="up"]', "aria-pressed") == "true", "the rating survives a reload"
    assert page.input_value(".done-box textarea") == "Best sandwich of the year.", "and so does the note"
    page.goto(site.base + "/me/")
    page.wait_for_selector(".me-list li")
    row = page.locator(".me-list li").first
    assert mission["name"] in row.inner_text() and "Loved it" in row.inner_text()
    assert "Best sandwich of the year." in row.inner_text()
    page.goto(site.base + path)
    page.click(".done-entry summary")
    page.click(".done-remove")
    sure = page.inner_text(".done-remove-sure")
    assert "takes back" in sure and "First Steps" in sure and "comes back if you mark it done again" in sure.replace("They come", "It comes"), sure
    page.click(".done-remove-keep")
    assert page.locator(".done-entry").count() == 1, "Keep it keeps it"
    page.click(".done-remove")
    page.click(".done-remove-yes")
    page.wait_for_selector(".done-lead")
    page.wait_for_function("() => [...document.querySelectorAll('.done-box .sr')].some(e => e.textContent.includes('taken back too'))")   # and says so
    page.goto(site.base + "/me/")
    page.wait_for_selector("text=Nothing marked done yet")


def t_done_again_counts_and_the_day_can_change(site, catalog):
    mission = catalog["missions"][1]
    page = site.open(f"/missions/{mission['id']}/")
    mark(page)
    page.fill('.done-box input[type="date"]', "2025-06-01")
    page.wait_for_function("() => document.querySelector('.done-entry summary').textContent.includes('June 1, 2025')")
    assert page.inner_text(".done-mark") == "Mark done again", "the done button stays, for next time"
    assert "null" not in page.inner_text(".done-box"), "no stray null"
    mark(page)
    page.wait_for_selector(".done-times")
    assert "2 times" in page.inner_text(".done-head")
    assert page.locator(".done-entry").count() == 2 and page.locator(".done-entry[open]").count() == 1
    assert page.locator(".done-entry summary").nth(1).inner_text().startswith("Done June 1, 2025"), "newest first"
    page.goto(site.base + f"/packs/{mission['pack']}/")
    chip = page.locator(f'a.card[href="/missions/{mission["id"]}/"] .done-chip')
    chip.wait_for()
    assert "Done ×2" in chip.inner_text(), "cards of missions you've done say so"
    assert page.locator(".card .done-chip").count() == 1
    page.goto(site.base + "/me/")
    page.wait_for_selector(".me-list li")
    assert page.locator(".me-list li").count() == 2
    assert "1 mission done" in page.inner_text("#me-done-title")
    assert "since Jun 1, 2025" in page.inner_text(".me-done .hint")


def t_not_for_us_is_never_picked(site, catalog):
    ids = [m["full_id"] for m in catalog["missions"]]
    keep = next(m for m in catalog["missions"] if m["pack"] == "anywhere")   # with no ZIP set, a roll deals from Anywhere
    hidden = [i for i in ids if i != keep["full_id"]]
    page = site.open("/missions/" + keep["id"] + "/")
    page.evaluate("h => localStorage.setItem('amble.done', JSON.stringify({v: 1, done: [], hidden: h}))", hidden)
    page.goto(site.base + "/")
    page.wait_for_selector("#packs .card", state="attached")
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert page.inner_text("#reveal-title") == keep["name"], "only the mission that isn't hidden can be picked"
    assert page.locator("#reveal-done .done-mark").count() == 1, "Mark done is under a picked mission too"
    mark(page, '#reveal-done')
    page.wait_for_selector("#reveal-done .done-head")


def t_marking_one_down_offers_not_for_us(site, catalog):
    mission = catalog["missions"][2]
    page = site.open(f"/missions/{mission['id']}/")
    mark(page)
    assert page.locator('.done-box label.check:has-text("Not for us")').count() == 0
    page.click('[data-rate="down"]')
    page.check('.done-box label.check:has-text("Not for us") input')
    page.goto(site.base + f"/packs/{mission['pack']}/")
    card = page.locator(f'a.card[href="/missions/{mission["id"]}/"]')
    page.wait_for_selector(f'a.card.is-skipped[href="/missions/{mission["id"]}/"]')
    assert float(card.evaluate("a => getComputedStyle(a).opacity")) < 0.7, "Not for us missions are faded"
    assert page.locator("a.card.is-skipped").count() == 1, "only that one, and it keeps its place"
    assert card.locator(".skip-chip").inner_text() == "Not for us"
    page.goto(site.base + "/me/settings/")
    assert page.locator(".me-hidden").count() == 0, "without a profile, Settings is only Your profile"
    give_profile(site, page)
    page.wait_for_selector(".me-hidden .me-list li")
    page.click('.me-hidden button:has-text("Show it again")')
    page.wait_for_selector(".me-hidden .me-list", state="detached")
    assert "Not really" in page.inner_text(".me-hidden"), "with nothing set aside, it says how to set one aside"
    page.goto(site.base + f"/packs/{mission['pack']}/")
    page.wait_for_selector(f'a.card[href="/missions/{mission["id"]}/"] .done-chip')
    assert page.locator("a.card.is-skipped, .card .skip-chip").count() == 0, "Show it again brings it back to full colour"


def t_not_for_us_button_on_a_mission(site, catalog):
    mission = catalog["missions"][4]
    page = site.open(f"/missions/{mission['id']}/")
    btn = page.locator(".ticket .skip-btn")
    assert btn.inner_text() == "Not for us" and btn.get_attribute("aria-pressed") == "false"
    assert page.evaluate("getComputedStyle(document.querySelector('.ticket .skip-btn')).boxShadow").count("inset") == 1, "outlined"
    assert page.locator(".ticket-foot .report").count() == 1, "it sits with Report a problem"
    btn.click()
    assert btn.get_attribute("aria-pressed") == "true", "no need to mark it done first"
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.done')).hidden") == [mission["full_id"]]
    assert page.locator(".done-entry").count() == 0, "and it isn't marked done"
    page.goto(site.base + f"/packs/{mission['pack']}/")
    page.wait_for_selector(f'a.card.is-skipped[href="/missions/{mission["id"]}/"]')
    page.goto(site.base + f"/missions/{mission['id']}/")
    page.click(".ticket .skip-btn")
    assert page.get_attribute(".ticket .skip-btn", "aria-pressed") == "false", "tapping again brings it back"
    home = site.home()
    home.click("#roll-btn")
    home.wait_for_selector("#reveal-title")
    assert home.locator(".reveal .skip-btn, #reveal-slot .skip-btn").count() == 1, "a picked mission has it too"

# ---- free profiles (site/js/profile.js), against FakeIntake ----
def done_list(page, ids):
    """This browser has done these missions (full ids), as if marked done."""
    page.evaluate("ids => localStorage.setItem('amble.done', JSON.stringify({v: 1, hidden: [], "
                  "done: ids.map(i => ({mission: i, done_at: '2026-11-01T18:00:00Z'}))}))", ids)


def t_rolls_pick_something_new_until_asked(site, catalog):
    anywhere = [m for m in catalog["missions"] if m["pack"] == "anywhere"]   # with no ZIP set, a roll deals from Anywhere
    keep = anywhere[0]
    page = site.open("/missions/" + keep["id"] + "/")
    done_list(page, [m["full_id"] for m in anywhere[1:]])
    page.goto(site.base + "/")
    page.wait_for_selector("#packs .card", state="attached")
    page.click("#roll-btn")
    for _ in range(3):
        page.wait_for_selector("#reveal-title")
        assert page.inner_text("#reveal-title") == keep["name"], "the one not done yet is picked"
        assert "haven't done" in page.inner_text("#reveal-fresh")
        page.click("#reveal-actions >> text=Open another")
    page.wait_for_selector("#reveal-title")
    page.click("#reveal-fresh >> text=Include them too")
    assert page.evaluate("localStorage.getItem('amble.roll.repeats')") == "1", "the choice is remembered"
    assert "including ones you've done" in page.inner_text("#reveal-fresh")
    names = set()
    for _ in range(12):
        page.click("#reveal-actions >> text=Open another")
        page.wait_for_selector("#reveal-title")
        names.add(page.inner_text("#reveal-title"))
    assert len(names) > 1, "with repeats on, done missions come up again"
    page.click("#reveal-fresh >> text=Only ones we haven't done")
    assert page.evaluate("localStorage.getItem('amble.roll.repeats')") is None
    # every one done: it says so, and still deals
    done_list(page, [m["full_id"] for m in anywhere])
    page.goto(site.base + "/")
    page.wait_for_selector("#packs .card", state="attached")
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    assert "every mission that fits" in page.inner_text("#reveal-fresh")


def t_hide_ones_we_have_done_filter(site, catalog):
    page = site.home()
    page.click("#filters-toggle")
    assert page.locator("#new-field").is_hidden(), "nothing done yet: no filter to show"
    done = catalog["missions"][0]
    done_list(page, [done["full_id"]])
    page.reload()
    page.wait_for_selector("#packs .card", state="attached")
    page.click("#filters-toggle")
    page.click("#new-field label:has(#f-new)")
    page.wait_for_function("location.search.includes('new=1')")
    assert page.locator("#packs .card").count() == len(catalog["missions"]) - 1, "every mission but the done one"
    assert page.locator(f'#packs a.card[href*="/missions/{done["id"]}/"]').count() == 0
    page.goto(site.base + "/?new=1")
    page.wait_for_selector("#packs .card", state="attached")
    assert page.is_checked("#f-new"), "the filter comes back from the address"


def t_mark_done_mentions_stamps_until_the_first(site, catalog):
    mission = catalog["missions"][0]
    page = site.open(f"/missions/{mission['id']}/")
    page.wait_for_selector(".done-mark")
    assert "collect stamps" in page.inner_text(".done-box")
    mark(page)
    page.reload()
    page.wait_for_selector(".done-head")
    other = catalog["missions"][1]
    page.goto(site.base + f"/missions/{other['id']}/")
    page.wait_for_selector(".done-mark")
    assert page.locator(".done-stamp-hint").count() == 0, "once a stamp is earned, the hint has done its job"


def t_profile_nudges_for_a_recovery_email_and_masks_it(site, catalog):
    page = site.open("/me/")
    assert "has-profile" not in (page.get_attribute(".top .nav-profile", "class") or "")
    key = give_profile(site, page)
    page.wait_for_selector(".profile-bar.is-saved")
    assert "has-profile" in page.get_attribute(".top .nav-profile", "class"), "the header shows there's a profile"
    assert "your link is the only way back in" in page.inner_text(".profile-bar"), "the gentle nudge (decision 49)"
    page.click(".profile-bar .nudge-later")
    assert page.locator(".profile-bar-nudge").count() == 0, "Not now hides it"
    page.reload()
    page.wait_for_selector(".profile-bar.is-saved")
    assert page.locator(".profile-bar-nudge").count() == 0, "for 30 days, not just this visit"
    page.evaluate("localStorage.removeItem('amble.nudge.email')")
    site.intake.profiles[key]["email"] = True
    page.evaluate("localStorage.setItem('amble.email', 'maxwell@example.com');"
                  "const p = JSON.parse(localStorage.getItem('amble.profile')); p.email = true;"
                  "localStorage.setItem('amble.profile', JSON.stringify(p))")
    page.reload()
    page.wait_for_selector(".profile-bar.is-saved")
    assert "only way back in" not in page.inner_text(".profile-bar")
    assert "null" not in page.inner_text(".profile-bar"), "no stray null where the nudge was"
    page.goto(site.base + "/me/settings/")
    page.wait_for_selector("label[for=me-email]")
    label = page.inner_text("label[for=me-email]")
    assert "m•••••l@e•••••e.com" in label and "maxwell" not in label, label
    page.goto(site.base + "/contact/")
    page.wait_for_selector(".intake-form", state="visible")
    assert page.input_value("#contact-email") == "maxwell@example.com"
    assert page.locator(".filled-note").inner_text().endswith("Filled in from your profile")
    page.fill("#contact-email", "other@example.com")
    assert page.locator(".filled-note").count() == 0, "typed over: no longer from the profile"


def t_faq_explains_profiles_and_stamps(site, catalog):
    page = site.open("/faq/")
    for q in ("profile", "notes", "lost", "stamp-gone", "not-for-us"):
        assert page.locator(f"details#{q} summary").count() == 1, q


def t_mark_done_offers_a_free_profile_until_not_now(site, catalog):
    mission = catalog["missions"][5]
    before = len(site.intake.posts)
    page = site.open(f"/missions/{mission['id']}/")
    page.click(".done-mark")
    page.wait_for_selector(".profile-dlg[open]")
    text = page.inner_text(".profile-dlg")
    assert "Marked done! Keep it safe?" in text and "no password" in text.lower(), text
    assert "only keep your mission log" in text.lower() and "notes you write" in text, "it says what's kept"
    assert page.locator(".done-entry").count() == 1, "the mission is marked whatever they choose"
    page.click(".profile-dlg .profile-start")
    text = page.inner_text(".profile-dlg")
    assert "Add an email and display name" in text and "scrambled fingerprint" in text and "optional" in text, "step 2, and how the email is handled"
    page.keyboard.press("Escape")
    page.wait_for_selector(".profile-dlg[open]", state="detached")
    page.click(".done-mark")
    page.wait_for_selector(".profile-dlg[open]")   # closing it isn't a No: it asks again
    page.click(".profile-dlg .profile-later")
    page.wait_for_selector(".profile-dlg[open]", state="detached")
    page.click(".done-mark")
    assert page.locator(".profile-dlg[open]").count() == 0, "after Not now it stops asking"
    page.goto(site.base + f"/missions/{catalog['missions'][8]['id']}/")
    page.click(".done-mark")
    assert page.locator(".profile-dlg[open]").count() == 0, "on every page of this browser"
    page.goto(site.base + "/me/")
    page.wait_for_selector(".profile-bar.is-local")
    assert "Only on this device" in page.inner_text(".profile-bar")
    page.click('.profile-bar button:has-text("Start a free profile")')
    page.wait_for_selector(".profile-dlg[open]")   # asking for one still works
    assert "Start a free profile" in page.inner_text(".profile-dlg h2")
    page.keyboard.press("Escape")
    page.goto(site.base + "/me/settings/")
    sections = page.locator(".me-app > section").evaluate_all("els => els.map(e => e.id)")
    assert sections == ["profile"], f"without a profile, Settings is only Your profile: {sections}"
    assert not [p for p, _ in site.intake.posts[before:] if p.startswith("/profile")], "nothing goes to the server without a profile"


def start_profile(page, email="", name=""):
    """The start-a-profile steps (decision 44): Start my profile, then an email and display name. Without an email it
    takes "I understand" first."""
    page.click(".profile-dlg .profile-start")
    page.wait_for_selector("#profile-email")
    if email:
        page.fill("#profile-email", email)
    if name:
        page.fill("#profile-name", name)
    page.click(".profile-dlg .profile-continue")
    if not email:
        page.check("#profile-understand")
        page.click(".profile-dlg .profile-without")


def t_start_a_profile_and_it_keeps_up(site, catalog):
    mission = catalog["missions"][6]
    page = site.open(f"/missions/{mission['id']}/")
    page.click(".done-mark")
    page.wait_for_selector(".profile-dlg[open]")
    start_profile(page, "max@example.com")
    page.wait_for_selector("#profile-link")
    link = page.input_value("#profile-link")
    key = link.split("#", 1)[1]
    assert link.startswith(site.base + "/me/#") and len(key) == 22, link
    assert page.inner_text(".profile-dlg .recovery-code") == key and "emailed both" in page.inner_text(".profile-dlg")
    made = [d for p, d in site.intake.posts if p == "/profile"][-1]
    assert made["key"] == key and made["email"] == "max@example.com"
    assert set(made["vault"]) == {"wk", "we", "salt"}, "the notes key goes along, locked with the link and with the email"
    page.wait_for_function("k => (JSON.parse(localStorage.getItem('amble.profile')) || {}).since", arg=key)
    prof = site.intake.profiles[key]
    assert [c["mission"] for c in prof["done"].values()] == [mission["full_id"]], "the mission went to the profile"
    page.click(".profile-dlg .btn.primary")
    page.click('[data-rate="up"]')
    page.wait_for_function("() => (JSON.parse(localStorage.getItem('amble.done')).dirty || []).length === 0")
    assert [c["rating"] for c in prof["done"].values()] == ["up"], "a change follows on its own"
    assert "Saved to your profile" in page.inner_text(".done-box .hint")
    page.click(".done-mark")
    page.wait_for_selector(".done-times")
    assert page.locator(".profile-dlg[open]").count() == 0, "with a profile, no more asking"
    page.goto(site.base + "/me/")
    page.wait_for_selector(".profile-bar.is-saved")
    assert "Saved to your profile" in page.inner_text(".profile-bar")
    page.goto(site.base + "/me/settings/")
    page.click(".me-show-link")
    assert page.input_value("#me-link").endswith("#" + key) and page.inner_text(".me-profile .recovery-code") == key
    assert not page.is_visible(".me-show-link"), "the button steps aside once it's done its job"
    qr = page.locator(".me-qr svg.qr")
    assert qr.get_attribute("aria-label") == "QR code for your profile link" and qr.bounding_box()["width"] >= 150, "a QR code to scan"
    assert page.evaluate("JSON.stringify(AmbleQR.matrix('https://amblebee.com/me/#' + 'k'.repeat(22)).length)") == "33", "a profile link fits a small, easy code"
    assert "stays signed in" in page.inner_text(".me-qr")
    page.goto(site.base + "/contact/")   # the email given with the profile fills in the forms on this device
    page.wait_for_selector("#contact-email")
    page.wait_for_function("() => document.querySelector('#contact-email').value === 'max@example.com'")
    page.goto(site.base + "/report/")
    page.wait_for_function("() => document.querySelector('#report-email').value === 'max@example.com'")
    page.goto(site.base + "/me/settings/")
    page.click(".me-show-link")
    page.click(".me-profile .linkish:has-text('Remove the recovery email')")
    page.wait_for_selector("text=Recovery email removed")
    assert prof["email"] is False
    assert page.evaluate("localStorage.getItem('amble.email')") is None, "removing it forgets it here too"
    page.click(".me-sign-out")
    page.click(".me-sign-out")
    page.wait_for_selector(".me-start")
    assert page.evaluate("localStorage.getItem('amble.profile')") is None
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.done')).done.length") == 0, "signing out forgets the missions here"
    assert key in site.intake.profiles, "but the profile is still there"

    other = site.open("/me/#" + key)   # the link on another device
    other.wait_for_selector(".me-list li")
    assert mission["name"] in other.inner_text(".me-list") and other.evaluate("location.hash") == "", "it opens, and the key leaves the address"
    other.wait_for_selector(".profile-bar.is-saved")
    other.goto(site.base + "/me/settings/")
    other.click(".me-remove-btn")
    other.click(".me-remove-yes")
    other.wait_for_selector("text=Your account was removed")
    assert key not in site.intake.profiles, "Remove account removes the profile from the server"
    assert other.evaluate("localStorage.getItem('amble.profile')") is None


def t_notes_are_locked_with_the_link(site, catalog):
    mission = catalog["missions"][9]
    page = site.open(f"/missions/{mission['id']}/")
    page.click(".done-mark")
    start_profile(page)
    page.wait_for_selector("#profile-link")
    key = page.input_value("#profile-link").split("#", 1)[1]
    page.click(".profile-dlg .btn.primary")
    page.fill(".done-box textarea", "Sarah's birthday, best cocoa")
    page.locator(".done-box textarea").blur()
    page.wait_for_function("() => !JSON.parse(localStorage.getItem('amble.done')).dirty.length")
    stored = list(site.intake.profiles[key]["done"].values())[0]["note"]
    assert stored.startswith("n1:") and "Sarah" not in stored and "cocoa" not in stored, f"the server only gets a locked note: {stored[:40]}"
    assert site.intake.profiles[key]["vault"]["wk"], "with the notes key, locked with the link"
    other = site.open("/me/#" + key)
    other.wait_for_selector(".me-note")
    assert other.inner_text(".me-note") == "Sarah's birthday, best cocoa", "the link opens them on another device"

def t_opening_a_profile_link_keeps_its_settings(site, catalog):
    page = site.open(f"/missions/{catalog['missions'][7]['id']}/")
    page.click(".done-mark")
    start_profile(page)
    page.wait_for_selector("#profile-link")
    key = page.input_value("#profile-link").split("#", 1)[1]
    page.goto(site.base + "/me/settings/")
    page.select_option("#me-home", "oregon")
    page.wait_for_function("() => !JSON.parse(localStorage.getItem('amble.done')).prefs_dirty")
    other = site.open("/me/#" + key)   # a fresh device has no settings of its own: it mustn't send empty ones
    other.wait_for_selector(".profile-bar.is-saved")
    other.goto(site.base + "/me/settings/")
    assert other.input_value("#me-home") == "oregon", "the profile's home state survives"
    assert site.intake.profiles[key]["prefs"]["settings"] == {"home_state": "oregon"}

def t_a_profile_link_that_stopped_working(site, catalog):
    page = site.open("/me/#" + "x" * 22)
    page.wait_for_selector(".profile-bar.is-gone")
    assert "stopped working" in page.inner_text(".profile-bar")
    page.goto(site.base + "/me/settings/")
    page.wait_for_selector(".me-profile .form-status.bad")
    page.fill("#me-lost", "max@example.com")
    page.click(".me-lost-form button")
    page.wait_for_selector("text=a new link is on its way")
    sent = [d for p, d in site.intake.posts if p == "/profile/lost"][-1]
    assert sent["email"] == "max@example.com" and sent["website"] == "" and sent["elapsed_ms"] >= 0

def t_backup_code_moves_the_list(site, catalog):
    mission = catalog["missions"][3]
    page = site.open(f"/missions/{mission['id']}/")
    mark(page)
    page.goto(site.base + "/me/settings/")
    give_profile(site, page)
    page.click('button:has-text("Copy a backup code")')
    page.wait_for_selector("#me-code:not([hidden])")
    code = page.input_value("#me-code")
    assert code.startswith("AMB1:")
    with page.expect_download() as saved:
        page.click('button:has-text("Download a backup file")')
    assert saved.value.suggested_filename.startswith("amblebee-missions-")
    other = site.open("/me/")   # a fresh browser: nothing there yet
    other.wait_for_selector("text=Nothing marked done yet")
    other.goto(site.base + "/me/settings/")
    give_profile(site, other)
    other.fill("#me-paste", "not a real code")
    other.click('button:has-text("Add from this code")')
    other.wait_for_selector(".form-status.bad")
    other.fill("#me-paste", code)
    other.click('button:has-text("Add from this code")')
    other.wait_for_selector("text=Added 1 mission")
    other.fill("#me-paste", code)
    other.click('button:has-text("Add from this code")')
    other.wait_for_selector("text=already here")
    other.goto(site.base + "/me/")
    other.wait_for_selector(".me-list li")
    assert mission["name"] in other.inner_text(".me-list")
    assert other.locator(".me-list li").count() == 1, "the same backup twice doesn't double up"


# ---- Stamps and the stamp book (site/js/stamps.js, site/js/book.js) ----
STAMP_HELPERS = """
  window.mk = (mission, y, m, d, extra) => Object.assign({
    rid: (mission.replace(/[^a-z0-9]/g, '') + y + m + d + Math.random().toString(36).slice(2, 6)).slice(-16),
    mission: 'max/' + mission, slug: mission, name: mission,
    done_at: new Date(y, m - 1, d, 12).toISOString(),
    snapshot: { pack: 'anywhere', mode: 'adventure', setting: 'outdoor', time_of_day: 'any', themes: [] },
    as_date: false, rating: null, note: '' }, extra || {});
  window.inPack = (pack, mode) => ({ snapshot: { pack, mode: mode || 'adventure', setting: 'outdoor', time_of_day: 'any', themes: [] } });
  window.keys = (list, settings) => AmbleStamps.compute(list, settings).map(s => s.key);
"""


def t_stamp_rules_follow_the_stamp_book(site, catalog):
    page = site.open("/me/")
    page.wait_for_function("() => window.AmbleStamps")
    page.evaluate(STAMP_HELPERS)
    ev = page.evaluate
    assert ev("keys([])") == []
    assert ev("keys([mk('a', 2026, 3, 5)])") == ["first-steps", "our-year-2026"], "a first mission: First Steps and its year"
    assert ev("AmbleStamps.compute([mk('a', 2026, 3, 5)])[1].art") == "/stamps/our-year-2026.svg"
    assert ev("keys([mk('a', 2025, 3, 5)])") == ["first-steps"], "years before 2026 have passed: no year stamp"
    assert ev("AmbleStamps.compute([mk('a', 2031, 3, 5)])[1].art") == "/stamps/our-year.svg", "a year whose scene isn't drawn yet gets the plain one"
    assert ev("[2026, 2027, 2028, 2029, 2030].map(y => AmbleStamps.compute([mk('a', y, 3, 5)])[1].art)") == \
        [f"/stamps/our-year-{y}.svg" for y in range(2026, 2031)]
    assert ev("keys([mk('a', 2025, 12, 31), mk('b', 2026, 1, 1)])").count("our-year-2026") == 1
    # Lovebirds: a date mission, or a "both" mission done as a date
    assert "lovebirds" in ev("keys([mk('a', 2026, 3, 5, inPack('anywhere', 'date'))])")
    assert "lovebirds" not in ev("keys([mk('a', 2026, 3, 5, inPack('anywhere', 'both'))])")
    assert "lovebirds" in ev("keys([mk('a', 2026, 3, 5, Object.assign(inPack('anywhere', 'both'), { as_date: true }))])")
    # Road Tripper: three state packs (Anywhere isn't a state), earned on the third
    rt = ev("""AmbleStamps.compute([mk('a', 2026, 3, 1, inPack('oregon')), mk('b', 2026, 3, 2, inPack('anywhere')),
               mk('c', 2026, 3, 3, inPack('washington')), mk('d', 2026, 3, 4, inPack('oregon')), mk('e', 2026, 3, 5, inPack('idaho'))])
               .find(s => s.id === 'road-tripper')""")
    assert rt and rt["slug"] == "e", "Road Tripper is earned by the mission in the third state"
    assert rt["how"] == "Missions in three different states: Oregon, Washington and Idaho.", rt["how"]
    # Home Sweet Home: 10 different missions in your home state's pack, only once it's set
    home = "Array.from({ length: 10 }, (_, i) => mk('h' + i, 2026, 4, i + 1, inPack('oregon')))"
    assert "home-sweet-home" not in ev(f"keys({home})")
    assert "home-sweet-home" in ev(f"keys({home}, {{ home_state: 'oregon' }})")
    assert "home-sweet-home" not in ev("keys(Array.from({ length: 10 }, (_, i) => mk('same', 2026, 4, i + 1, inPack('oregon'))), { home_state: 'oregon' })"), \
        "the same mission ten times is one mission"
    # Seasons go by the day it was done; five different missions in one season
    assert "spring-has-sprung" in ev("keys(Array.from({ length: 5 }, (_, i) => mk('s' + i, 2026, 3 + (i % 3), 10)))")
    assert "spring-has-sprung" not in ev("keys(Array.from({ length: 5 }, (_, i) => mk('s0', 2026, 4, i + 1)))")
    assert "winter-wonderland" in ev("keys([mk('w1', 2025, 12, 5), mk('w2', 2026, 1, 5), mk('w3', 2026, 2, 5), mk('w4', 2027, 1, 5), mk('w5', 2027, 2, 5)])")
    assert "master-of-the-seasons" in ev("keys([mk('a', 2026, 1, 5), mk('a', 2026, 4, 5), mk('a', 2026, 7, 5), mk('a', 2026, 10, 5)])")
    assert "master-of-the-seasons" not in ev("keys([mk('a', 2026, 1, 5), mk('b', 2026, 4, 5), mk('c', 2026, 7, 5)])")
    # Our Anniversary: a date mission on the day (Feb 29 counts on Feb 28 in other years)
    assert "our-anniversary" in ev("keys([mk('a', 2025, 6, 14, inPack('anywhere', 'date'))], { anniversary: '06-14' })")
    assert "our-anniversary" not in ev("keys([mk('a', 2025, 6, 14)], { anniversary: '06-14' })"), "it has to be a date"
    assert "our-anniversary" not in ev("keys([mk('a', 2025, 6, 14, inPack('anywhere', 'date'))])"), "no anniversary set, no stamp"
    assert "our-anniversary" in ev("keys([mk('a', 2027, 2, 28, inPack('anywhere', 'date'))], { anniversary: '02-29' })")
    assert "anniversary, June 14" in ev("AmbleStamps.compute([mk('a', 2025, 6, 14, inPack('anywhere', 'date'))], { anniversary: '06-14' }).find(s => s.id === 'our-anniversary').how")
    assert ev("AmbleStamps.compute(Array.from({ length: 10 }, (_, i) => mk('h' + i, 2026, 4, i + 1, inPack('oregon'))), { home_state: 'oregon' }).find(s => s.id === 'home-sweet-home').how").endswith("Oregon.")
    assert all(ev("AmbleStamps.compute(Array.from({ length: 30 }, (_, i) => mk('x' + (i % 6), 2026, 1 + (i % 12), 1 + i, inPack(['oregon', 'idaho', 'utah'][i % 3], 'date')))).map(s => s.how)")), \
        "every stamp says how it was earned"
    # Old Favorites: five different missions done again
    fav = "Array.from({ length: 5 }, (_, i) => [mk('f' + i, 2026, 5, 1), mk('f' + i, 2026, 6, 1)]).flat()"
    assert "old-favorites" in ev(f"keys({fav})")
    assert "old-favorites" not in ev("keys(Array.from({ length: 9 }, (_, i) => mk('f0', 2026, 5, i + 1)))")
    # count milestones: every time out counts; First Steps is the first, then 10, 25, 50, 100, 200, 500, 1,000
    assert "milestone-25" in ev("keys(Array.from({ length: 25 }, (_, i) => mk('m' + (i % 3), 2026, 1 + (i % 12), 1 + i)))")
    assert "milestone-25" not in ev("keys(Array.from({ length: 24 }, (_, i) => mk('m' + i, 2026, 1 + (i % 12), 1 + i)))")
    many = ev("""AmbleStamps.compute(Array.from({ length: 1000 }, (_, i) => mk('m' + (i % 40), 2000 + Math.floor(i / 50), 1 + (i % 12), 1 + (i % 28))))
                 .filter(s => s.id.startsWith('milestone-')).map(s => [s.id, s.name, s.art])""")
    assert [m[0] for m in many] == ["milestone-%d" % n for n in (10, 25, 50, 100, 200, 500, 1000)], many
    assert many[-1][1] == "1,000 Missions" and many[-1][2] == "/stamps/milestone-1000.svg"
    assert "milestone-1" not in ev("keys([mk('a', 2026, 3, 5)])"), "First Steps is the first milestone"
    # Our Year of Adventures carries how many missions that year holds, and keeps counting after it's earned
    years = ev("AmbleStamps.compute([mk('a', 2027, 3, 1), mk('b', 2027, 9, 1), mk('a', 2027, 10, 1), mk('c', 2028, 1, 2)]).filter(s => s.year).map(s => [s.key, s.year_count, s.slug])")
    assert years == [["our-year-2027", 3, "a"], ["our-year-2028", 1, "c"]], years
    # in the order earned, and never a photo stamp on the website
    order = ev("AmbleStamps.compute([mk('a', 2026, 3, 5, inPack('anywhere', 'date')), mk('b', 2026, 3, 1)]).map(s => s.id + ':' + s.slug)")
    assert order == ["first-steps:b", "our-year:b", "lovebirds:a"], order
    assert not {"say-cheese", "the-scrapbook", "then-and-now"} & set(ev("AmbleStamps.all.map(s => s.id)"))


def t_a_new_stamp_lands_after_mark_done(site, catalog):
    mission = next(m for m in catalog["missions"] if m["mode"] == "date")
    page = site.open(f"/missions/{mission['id']}/")
    mark(page)
    page.wait_for_selector(".stamp-landing")
    text = page.inner_text(".stamp-landing")
    assert "First Steps" in text and "Lovebirds" in text and "Our Year of Adventures" in text
    assert page.locator(".stamp-landing .stamp-img.lands").count() == 3, "each new stamp lands"
    assert page.locator('.stamp-landing a[href="/me/"]').count() == 1
    page.click('[data-rate="up"]')
    assert page.locator(".stamp-landing").count() == 1 and page.locator(".stamp-img.lands").count() == 0, "it stays, standing still"
    page.reload()
    page.wait_for_selector(".done-head")
    assert page.locator(".stamp-landing").count() == 0, "a stamp lands once"
    mark(page)
    page.wait_for_selector(".done-times")
    assert page.locator(".stamp-landing").count() == 0, "doing it again earns nothing new here"

    calm = site.open(f"/missions/{mission['id']}/")   # reduce motion: the stamp is just there
    calm.emulate_media(reduced_motion="reduce")
    calm.reload()
    mark(calm)
    calm.wait_for_selector(".stamp-landing")
    assert calm.evaluate("getComputedStyle(document.querySelector('.stamp-landing .stamp-img')).animationName") == "none"


def t_stamp_book_in_order_with_find_pages(site, catalog):
    page = site.open("/me/")
    page.wait_for_selector(".book")
    assert page.evaluate("document.querySelector('.me-book').compareDocumentPosition(document.querySelector('.me-done')) & 4"), \
        "the stamp book comes first, then the missions done"
    assert page.locator(".book .stamp").count() == 0 and page.locator(".stamp-blank").count() == 12, "an empty book is all empty spots"
    assert "first stamp lands" in page.inner_text(".book-none")
    page.evaluate(STAMP_HELPERS)
    page.evaluate("""() => {
      const done = [];
      for (let y = 2027; y <= 2040; y++) done.push(mk('y' + y, y, 7, 4));                 // a year stamp each year
      done.push(mk('date', 2041, 2, 14, inPack('anywhere', 'date')));
      localStorage.setItem('amble.done', JSON.stringify({ v: 1, done, hidden: [], settings: {} }));
    }""")
    page.reload()
    page.wait_for_selector(".book .stamp")
    n = page.evaluate("AmbleStamps.earned().length")
    assert n == 19, n   # First Steps, 15 years, Summer Lovin' (5 Julys), 10 Missions, Lovebirds
    assert page.locator(".book .stamp").count() == 12 and "Pages 1–2 of 4" in page.inner_text(".book-where")
    first = page.locator(".book .stamp-spot").first.inner_text()
    assert "First Steps" in first and "y2027" in first and "Jul 4, 2027" in first, "the book starts with the first stamp earned"
    assert page.locator(".stamp-spot.open-spot").count() == 0
    page.click(".book-next")
    assert "Pages 3–4 of 4" in page.inner_text(".book-where") and page.locator(".book .stamp").count() == 7
    assert page.locator(".stamp-spot.open-spot").count() == 5 and page.locator(".stamp-spot.open-spot").all_inner_texts() == [""] * 5, \
        "empty spots have no names"
    assert page.is_disabled(".book-next")
    page.click(".book-back")
    page.click(".book-newest")
    assert "Pages 3–4" in page.inner_text(".book-where")
    page.wait_for_function("() => (document.activeElement.getAttribute('aria-label') || '').startsWith('Lovebirds')")   # Newest stamp goes to it
    page.click('.book-menu [data-view="seasons"]')
    page.wait_for_selector("h3#book-title:has-text('Seasons')")
    assert page.evaluate("location.hash") == "", "Find a stamp pages leave the address alone"
    assert page.locator(".book-page.find .stamp").count() == 1 and "Summer Lovin'" in page.inner_text(".book-page.find")
    assert page.inner_text('.book-menu [data-view="memories"] small') == "16"
    page.click('.book-menu [data-view="memories"]')
    page.wait_for_selector("h3#book-title:has-text('Memories')")
    assert "10 Missions" in page.inner_text(".book-page.find")
    assert "1 mission" in page.locator(".book-page.find .stamp-spot").first.inner_text(), "a year stamp says how many missions that year"
    page.click('.book-menu [data-view="places"]')
    page.wait_for_selector("h3#book-title:has-text('Places')")
    assert "None here yet" in page.inner_text(".book-view")
    page.click('.book-menu [data-view="book"]')
    page.wait_for_selector(".book .stamp")
    assert "Pages 3–4" in page.inner_text(".book-where"), "the book stays open where you left it"
    page.click(".book-back")
    page.locator(".book .stamp").first.click()
    page.wait_for_selector(".stamp-dialog[open]")
    assert "First Steps" in page.inner_text(".stamp-dialog") and page.locator('.stamp-dialog a[href="/missions/y2027/"]').count() == 1
    assert page.inner_text(".stamp-how") == "HOW YOU EARNED IT\nYour very first mission marked done." or \
        page.inner_text(".stamp-how p") == "Your very first mission marked done."
    assert page.locator(".stamp-dialog .stamp-year-count").count() == 0, "only year stamps show a count"
    page.keyboard.press("Escape")
    assert page.evaluate("document.activeElement.classList.contains('stamp')"), "closing goes back to the stamp"
    page.locator(".book .stamp").nth(1).click()
    page.wait_for_selector(".stamp-dialog[open]")
    assert page.inner_text(".stamp-dialog .stamp-year-count") == "1 mission in 2027."
    page.keyboard.press("Escape")
    phone = site.open("/me/", viewport={"width": 390, "height": 900})
    phone.wait_for_selector(".book")
    assert phone.locator(".book-page").count() == 1, "one page at a time on a phone"
    phone.set_viewport_size({"width": 1100, "height": 900})   # turned sideways or a wider window: two pages, once it redraws
    phone.wait_for_function("() => document.querySelectorAll('.book-page').length === 2")
    assert page.locator('meta[name="robots"][content="noindex"]').count() == 1


def t_stamp_settings_are_kept_and_backed_up(site, catalog):
    oregon = [m for m in catalog["missions"] if m["pack"] == "oregon"][:10]
    if len(oregon) < 10:
        return
    page = site.open("/me/settings/")
    page.evaluate("ms => localStorage.setItem('amble.done', JSON.stringify({ v: 1, hidden: [], done: ms.map((m, i) => ({"
                  " rid: 'or' + String(i).padStart(4, '0'), mission: m.full_id, slug: m.id, name: m.name,"
                  " done_at: new Date(2026, 3, i + 1, 12).toISOString(),"
                  " snapshot: { pack: m.pack, mode: m.mode, setting: '', time_of_day: '', themes: [] } })) }))", oregon)
    give_profile(site, page)
    page.wait_for_selector(".me-stamps")
    page.select_option("#me-home", "oregon")
    page.wait_for_selector("text=Home state saved")
    assert "Home Sweet Home" in page.inner_text(".form-status"), "setting it says which stamp it earned"
    assert page.evaluate("document.activeElement.id") == "me-home"
    assert "The day you got together" in page.inner_text(".me-ann"), "says whose anniversary it means"
    page.select_option("#me-ann-month", "02")
    page.select_option("#me-ann-day", "31")
    page.wait_for_selector("text=Anniversary saved")
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.done')).settings") == {"home_state": "oregon", "anniversary": "02-29"}
    page.click('button:has-text("Copy a backup code")')
    code = page.input_value("#me-code")
    other = site.open("/me/settings/")
    give_profile(site, other)
    other.fill("#me-paste", code)
    other.click('button:has-text("Add from this code")')
    other.wait_for_selector("text=Added 10 missions")
    assert other.input_value("#me-home") == "oregon" and other.input_value("#me-ann-day") == "29", "the backup brings the settings"
    other.goto(site.base + "/me/")
    other.click('.book-menu [data-view="places"]')
    other.wait_for_selector(".book-page.find .stamp")
    assert "Home Sweet Home" in other.inner_text(".book-page.find")
    other.click(".me-settings-link")
    other.wait_for_url("**/me/settings/")
    other.select_option("#me-home", "")
    other.wait_for_selector("text=Home state cleared")
    assert "home_state" not in other.evaluate("JSON.parse(localStorage.getItem('amble.done')).settings")
    # Remove account: one more question first, then everything on this device goes
    other.click(".me-remove-btn")
    assert other.is_visible(".me-remove-yes") and other.evaluate("document.activeElement.textContent") == "Cancel"
    assert not other.is_visible(".me-remove-btn"), "while it asks, the first button steps aside"
    other.click(".me-remove-cancel")
    assert not other.is_visible(".me-remove-yes") and other.evaluate("JSON.parse(localStorage.getItem('amble.done')).done.length") == 10
    other.click(".me-remove-btn")
    other.click(".me-remove-yes")
    other.wait_for_selector("text=Your account was removed")
    left = other.evaluate("JSON.parse(localStorage.getItem('amble.done'))")
    assert (left["done"], left["hidden"], left["settings"]) == ([], [], {}), left
    other.wait_for_selector(".me-start")
    assert other.locator("#me-ann-month").count() == 0, "no profile any more: Settings is back to just Your profile"
    other.goto(site.base + "/me/")
    other.wait_for_selector("text=Nothing marked done yet")
    assert other.locator(".book .stamp").count() == 0, "and the stamps with it"


# ---- Plans: Add to calendar, My plans, "Did you go?" and Planned Ahead (site/js/plans.js; calendar-voting-PLAN.md branch 1) ----
def plan_mission(catalog):
    """A mission with a place, a short duration and no winter season, so every part of the dialog shows."""
    return next(m for m in catalog["missions"] if isinstance(m.get("season"), list) and "winter" not in m["season"]
                and (m.get("place") or {}).get("address") and m.get("duration") == "short")


JS_DAY = "n => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }"


def put_plan(page, m, day_offset, added_offset, pid="pppppp01"):
    """A plan made added_offset days ago for a day day_offset days from today, written straight into this browser."""
    page.evaluate("""([m, d, a, pid, js]) => {
        const day = eval(js);
        const added = new Date(); added.setDate(added.getDate() + a);
        const st = JSON.parse(localStorage.getItem('amble.done') || '{"v":1,"done":[],"hidden":[],"settings":{},"dirty":[],"removed":[]}');
        st.plans = (st.plans || []).concat([{ id: pid, mission: m.full_id, slug: m.id, name: m.name, day: day(d), time: null,
                                              source: 'calendar', added_at: added.toISOString(), updated_at: added.toISOString() }]);
        localStorage.setItem('amble.done', JSON.stringify(st));
    }""", [m, day_offset, added_offset, pid, JS_DAY])


def t_add_to_calendar_builds_each_calendar(site, catalog):
    from urllib.parse import urlparse, parse_qs
    m = plan_mission(catalog)
    page = site.open(f"/missions/{m['id']}/")
    btn, skip = page.locator(".ticket .plan-btn"), page.locator(".ticket .skip-btn")
    b, k = btn.bounding_box(), skip.bounding_box()
    assert b["x"] < k["x"] and b["y"] + b["height"] <= k["y"], "Add to calendar is on the left, on its own row above Not for us"
    assert btn.evaluate("e => getComputedStyle(e).backgroundColor") != skip.evaluate("e => getComputedStyle(e).backgroundColor"), "and looks different"
    btn.click()
    page.wait_for_selector("#plan-dialog[open]")
    saturday = page.evaluate("(() => { const t = new Date(); t.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7 || 7)); return t; })()")
    assert page.evaluate("document.activeElement.id") == "plan-day"
    assert page.evaluate("new Date(document.querySelector('#plan-day').value + 'T12:00').getDay()") == 6, "the day starts on the next Saturday"
    page.fill("#plan-day", "2027-07-04")                                        # all day, in season
    g = urlparse(page.get_attribute(".plan-google", "href")); gq = parse_qs(g.query)
    assert g.netloc == "calendar.google.com" and gq["action"] == ["TEMPLATE"] and gq["dates"] == ["20270704/20270705"], gq
    assert gq["text"] == [f"{m['name']} · AmbleBee"] and f"/missions/{m['id']}/" in gq["details"][0] and "ctz" not in gq
    assert m["place"]["name"] in gq["location"][0]
    o = urlparse(page.get_attribute(".plan-outlook", "href")); oq = parse_qs(o.query)
    assert (o.netloc, o.path) == ("outlook.live.com", "/calendar/0/action/compose") and oq["rru"] == ["addevent"]
    assert oq["startdt"] == ["2027-07-04"] and oq["enddt"] == ["2027-07-05"] and oq["allday"] == ["true"], oq
    assert urlparse(page.get_attribute(".plan-outlook-work", "href")).netloc == "outlook.office.com", "work and school accounts"
    assert page.inner_text(".plan-season") == "", "in season: no warning"
    page.fill("#plan-day", "2027-01-16")                                        # out of season: a warning, never a block
    assert "Out of season on Saturday, January 16, 2027" in page.inner_text(".plan-season")
    assert page.get_attribute(".plan-google", "href")
    page.check("input[name=plan-when][value=time]")
    page.fill("#plan-time", "10:30")
    assert page.input_value("#plan-length") == "2", "a short mission starts at 2 hours"
    gq = parse_qs(urlparse(page.get_attribute(".plan-google", "href")).query)
    assert gq["dates"] == ["20270116T103000/20270116T123000"] and gq.get("ctz"), "local times, read in the person's own zone"
    oq = parse_qs(urlparse(page.get_attribute(".plan-outlook", "href")).query)
    assert oq["startdt"] == [page.evaluate("new Date(2027, 0, 16, 10, 30).toISOString().replace(/\\.\\d{3}Z$/, 'Z')")] and oq["allday"] == ["false"]
    with page.expect_download() as d:
        page.click(".plan-ics")
    raw = Path(d.value.path()).read_bytes().decode("utf-8")
    assert d.value.suggested_filename == f"{m['id']}.ics"
    assert raw.startswith("BEGIN:VCALENDAR\r\n") and raw.endswith("END:VCALENDAR\r\n") and "\n" not in raw.replace("\r\n", "")
    assert all(len(line.encode()) <= 75 for line in raw.split("\r\n")), "lines are folded at 75 bytes"
    ics = raw.replace("\r\n ", "")
    assert "DTSTART:20270116T103000\r\n" in ics and "DTEND:20270116T123000\r\n" in ics, "floating local times, no zone pinned"
    assert "TRIGGER:-P1D\r\n" in ics, "reminded the day before"
    assert "\\," in ics.split("LOCATION:")[1].split("\r\n")[0], "commas are escaped"
    assert "Saved to My plans" in page.inner_text(".plan-done")
    page.keyboard.press("Escape")
    page.wait_for_selector("#plan-dialog", state="hidden")
    assert page.evaluate("document.activeElement.classList.contains('plan-btn')"), "focus goes back to the button"
    assert "Planned for Saturday, January 16, 2027 at 10:30 a.m." in page.inner_text(".ticket .plan-note")
    plans = page.evaluate("AmbleDone.plans()")
    assert len(plans) == 1 and plans[0]["day"] == "2027-01-16" and plans[0]["time"] == "10:30" and plans[0]["source"] == "calendar"
    # the same mission and day again only updates it
    page.click(".ticket .plan-btn")
    assert page.input_value("#plan-day") == "2027-01-16" and page.is_checked("input[name=plan-when][value=time]"), "opens on the plan"
    page.check("input[name=plan-when][value=all]")
    with page.expect_download():
        page.click(".plan-ics")
    plans = page.evaluate("AmbleDone.plans()")
    assert len(plans) == 1 and plans[0]["time"] is None, plans


def t_calendar_files_follow_the_standard(site, catalog):
    page = site.open("/missions/")
    page.goto(site.base + f"/missions/{plan_mission(catalog)['id']}/")
    run = lambda plan, extra="": page.evaluate("""([plan, extra]) => {
        const m = { full_id: 'amblebee/x', id: 'x', name: 'Café, "fun"; ok' + extra, short: 'Line one\\nline two \\\\ done', duration: 'all-day', season: 'any' };
        return AmblePlans.ics(AmblePlans.event(m, plan)).replace(/\\r\\n /g, ''); }""", [plan, extra])
    ics = run({"day": "2027-07-04", "time": None, "remind": "morning"})
    assert "DTSTART;VALUE=DATE:20270704\r\nDTEND;VALUE=DATE:20270705" in ics, "all day: an exclusive end date"
    assert 'SUMMARY:Café\\, "fun"\\; ok · AmbleBee' in ics and "Line one\\nline two \\\\ done" in ics, "text is escaped"
    assert "TRIGGER:PT8H" in ics and "LOCATION" not in ics and "GEO" not in ics, "8 a.m. on the day; Anywhere missions have no place"
    assert "TRIGGER:-PT15H" in run({"day": "2027-07-04", "time": None}), "all day, the day before: 9 a.m. that day"
    assert "VALARM" not in run({"day": "2027-07-04", "time": None, "remind": "none"})
    assert "TRIGGER:-PT1H30M" in run({"day": "2027-07-04", "time": "09:30", "remind": "morning"}), "8 a.m. on the day"
    assert "TRIGGER:-PT1H" in run({"day": "2027-07-04", "time": "07:00", "remind": "morning"}), "an hour ahead of an early start"
    assert "DTEND:20270704T150000" in run({"day": "2027-07-04", "time": "07:00", "hours": 8}), "all-day missions with a time: 8 hours"
    long = page.evaluate("""() => { const m = { full_id: 'amblebee/x', id: 'x', name: '🐝'.repeat(60), short: '', duration: 'short' };
        return AmblePlans.ics(AmblePlans.event(m, { day: '2027-07-04' })); }""")
    folded = [line for line in long.split("\r\n")]
    assert all(len(line.encode()) <= 75 for line in folded) and "�" not in long.replace("\r\n ", ""), "folding never splits an emoji"


def t_my_plans_and_coming_up(site, catalog):
    m = plan_mission(catalog)
    page = site.open("/me/plans/")
    page.wait_for_selector(".plan-empty")
    assert "Add to calendar" in page.inner_text(".plan-empty")
    page.goto(site.base + "/me/")
    assert not page.is_visible(".coming-up"), "no plans, no Coming up"
    page.goto(site.base + f"/missions/{m['id']}/")
    page.click(".ticket .plan-btn")
    page.fill("#plan-day", "2027-07-04")
    with page.expect_download():
        page.click(".plan-ics")
    page.keyboard.press("Escape")
    put_plan(page, catalog["missions"][3], 400, -1, "pppppp02")
    page.goto(site.base + "/me/")
    page.wait_for_selector(".coming-up li")
    assert page.locator(".coming-up li").count() == 2 and m["name"] in page.inner_text(".coming-up li >> nth=0"), "soonest first"
    page.click(".coming-up a:has-text('See all my plans')")
    page.wait_for_url("**/me/plans/")
    page.wait_for_selector(".plan-item")
    first = page.inner_text(".plan-item >> nth=0")
    assert "Sunday, July 4, 2027" in first and m["name"] in first and "From your calendar" in first, first
    assert page.locator('.nav-profile[aria-current="page"]').count() == 1
    page.click(".plan-item >> nth=0 >> .plan-again")
    page.wait_for_selector("#plan-dialog[open]")
    assert page.input_value("#plan-day") == "2027-07-04", "Add to calendar again opens on that day"
    page.keyboard.press("Escape")
    page.click(".plan-item >> nth=0 >> .plan-remove")
    page.wait_for_function("() => document.querySelectorAll('.plan-item').length === 1")
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.done')).plans_removed").count("pppppp02") == 0
    assert page.evaluate("AmbleDone.plans().length") == 1


def t_did_you_go_marks_it_done_and_planned_ahead(site, catalog):
    m = plan_mission(catalog)
    page = site.open(f"/missions/{m['id']}/")
    put_plan(page, m, -3, -6)                                                # planned 3 days ahead, the day was 3 days ago
    page.reload()
    page.wait_for_selector(".done-box .plan-ask-box")
    assert "Did you go?" in page.inner_text(".plan-ask-box") and "You planned this for" in page.inner_text(".plan-ask-box")
    page.click(".plan-ask-box .plan-yes")
    page.wait_for_selector(".done-entry")
    c = page.evaluate("AmbleDone.list()[0]")
    want = page.evaluate(f"({JS_DAY})(-3)")
    assert c["via"] == "plan" and c["planned_at"] and page.evaluate("d => { const t = new Date(d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }", c["done_at"]) == want, "marked on the plan's day"
    assert page.evaluate("AmbleDone.plans().length") == 0 and not page.is_visible(".plan-ask-box"), "the plan is cleared"
    assert any(s["id"] == "planned-ahead" for s in page.evaluate("AmbleStamps.earned()")), "Planned Ahead"
    assert "Planned Ahead" in page.inner_text(".done-box"), "and it lands right there"

    other = catalog["missions"][5]                                           # We didn't go: nothing marked
    page.goto(site.base + f"/missions/{other['id']}/")
    put_plan(page, other, -2, -5, "pppppp03")
    page.reload()
    page.click(".plan-ask-box .plan-no")
    page.wait_for_selector(".plan-ask-box", state="detached")
    assert page.evaluate("AmbleDone.forMission(%s).length" % json.dumps(other["full_id"])) == 0
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.done')).plans_removed").count("pppppp03") == 1, "the removal reaches the profile"


def t_planned_ahead_needs_a_days_notice(site, catalog):
    m = plan_mission(catalog)
    page = site.open(f"/missions/{m['id']}/")
    put_plan(page, m, 0, 0)                                                   # planned this morning, for today
    page.reload()
    assert not page.is_visible(".plan-ask-box"), "today's plan isn't asked about yet"
    page.click(".done-mark")
    page.click(".profile-later")
    c = page.evaluate("AmbleDone.list()[0]")
    assert c["via"] == "plan", "marking it done uses the plan"
    assert not any(s["id"] == "planned-ahead" for s in page.evaluate("AmbleStamps.earned()")), "but a same-day plan isn't planning ahead"
    assert page.evaluate("AmbleDone.plans().length") == 0
    put_plan(page, m, 5, 0, "pppppp04")                                       # a later plan for the same mission stays
    put_plan(page, catalog["missions"][2], -70, -80, "pppppp05")              # 70 days past, never answered: cleared quietly
    assert [p["id"] for p in page.evaluate("AmbleDone.plans()")] == ["pppppp04"]


def t_plans_sync_with_the_profile(site, catalog):
    m = plan_mission(catalog)
    page = site.open(f"/missions/{m['id']}/")
    put_plan(page, catalog["missions"][4], 30, -1, "pppppp06")               # made before the profile: it moves in
    page.reload()
    page.click(".done-mark")
    start_profile(page)
    page.wait_for_selector("#profile-link")
    key = page.input_value("#profile-link").split("#", 1)[1]
    page.click(".profile-dlg .btn.primary")
    page.click(".ticket .plan-btn")
    page.fill("#plan-day", "2027-07-04")
    with page.expect_download():
        page.click(".plan-ics")
    page.keyboard.press("Escape")
    page.wait_for_function("() => { const d = JSON.parse(localStorage.getItem('amble.done')); return !d.plans_dirty.length && !d.dirty.length; }")
    plans = site.intake.profiles[key]["plans"]
    assert sorted(p["day"] for p in plans.values()) == sorted([page.evaluate(f"({JS_DAY})(30)"), "2027-07-04"]), plans
    other = site.open("/me/#" + key)                                         # another device
    other.wait_for_selector(".profile-bar.is-saved")
    other.goto(site.base + "/me/plans/")
    other.wait_for_selector(".plan-item")
    assert other.locator(".plan-item").count() == 2 and "Sunday, July 4, 2027" in other.inner_text(".plans-app")
    assert "Saved to your profile" in other.inner_text(".plans-app")
    other.click(".plan-item:has-text('July 4, 2027') .plan-remove")
    other.wait_for_function("() => !JSON.parse(localStorage.getItem('amble.done')).plans_removed.length")
    assert len(site.intake.profiles[key]["plans"]) == 1, "the removal reached the profile"
    page.evaluate("(() => { const s = JSON.parse(localStorage.getItem('amble.profile')); s.last = 0; localStorage.setItem('amble.profile', JSON.stringify(s)); })()")
    page.goto(site.base + "/me/plans/")                                      # (it checks for other devices' changes every 30 seconds)
    page.wait_for_function("() => document.querySelectorAll('.plan-item').length === 1")


def t_profile_menu(site, catalog):
    page = site.open("/about/")
    btn = page.locator(".top nav > a.nav-profile")
    assert btn.get_attribute("aria-expanded") == "false"
    btn.focus()
    page.keyboard.press("Enter")
    page.wait_for_selector("#profile-menu:not([hidden])")
    assert btn.get_attribute("aria-expanded") == "true"
    labels = page.locator("#profile-menu a").all_inner_texts()
    assert labels == ["My stamps and missions", "My plans", "Votes", "Support", "Start a free profile"], labels
    assert page.evaluate("document.activeElement.textContent") == "My stamps and missions", "the keyboard lands on the first item"
    page.keyboard.press("ArrowDown")
    assert page.evaluate("document.activeElement.textContent") == "My plans"
    page.keyboard.press("Escape")
    assert page.is_hidden("#profile-menu") and page.evaluate("document.activeElement.classList.contains('nav-profile')")
    page.keyboard.press(" ")
    assert page.is_visible("#profile-menu") and page.evaluate("document.activeElement.textContent") == "My stamps and missions", "Space opens it too"
    page.keyboard.press("Escape")
    btn.click()
    assert page.is_visible("#profile-menu"), "a click after using the keyboard still opens it"
    page.keyboard.press("Escape")
    btn.click()
    page.mouse.click(5, 600)
    assert page.is_hidden("#profile-menu"), "a tap outside closes it"
    assert page.is_hidden(".nav-profile .nav-dot"), "no dot with nothing waiting"
    put_plan(page, catalog["missions"][1], -2, -6)                           # a plan whose day has passed: a honey dot
    page.reload()
    assert page.is_visible(".nav-profile .nav-dot") and "1 plan to check" in page.inner_text(".nav-profile .sr")
    page.click(".top nav > a.nav-profile")
    assert page.is_visible("#profile-menu a[href='/me/plans/'] .nav-dot"), "and next to My plans"
    page.locator("#profile-menu a", has_text="My plans").click()
    page.wait_for_selector(".plan-ask")
    page.click(".plan-ask .plan-no")
    page.wait_for_function("() => document.querySelector('.nav-profile .nav-dot').hidden")
    phone = site.open("/contact/", PHONE)
    phone.click(".top nav > a.nav-profile")
    phone.locator("#profile-menu a", has_text="My plans").click()
    phone.wait_for_url("**/me/plans/")
    assert phone.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")


def t_add_to_calendar_in_the_popup(site, catalog):
    m = plan_mission(catalog)
    page = site.home()
    page.goto(site.base + "/#mission=" + m["full_id"].replace("/", "%2F") + "&from=page")
    page.wait_for_selector("#reveal-title")
    page.click(".ticket .plan-btn")
    page.wait_for_selector("#plan-dialog[open]")
    assert m["name"] in page.inner_text("#plan-dialog .gift-mission")
    page.keyboard.press("Escape")
    phone = site.open(f"/missions/{m['id']}/", PHONE)
    b = phone.locator(".ticket .plan-btn").bounding_box()
    assert b["width"] > 300, "a full-width row on phones"




# ---------- branch 2: profiles and messages (calendar-voting-PLAN.md, decisions 39 and 44 to 49) ----------

def t_no_email_needs_i_understand(site, catalog):
    page = site.open(f"/missions/{catalog['missions'][3]['id']}/")
    page.click(".done-mark")
    page.click(".profile-dlg .profile-start")
    page.fill("#profile-name", "Max")
    page.click(".profile-dlg .profile-continue")
    page.wait_for_selector(".profile-caution", state="visible")
    assert "gone for good" in page.inner_text(".profile-caution")
    assert page.is_disabled(".profile-without"), "Continue without an email waits for I understand"
    page.click(".profile-add-email")
    assert page.locator(".profile-caution").is_hidden() and page.evaluate("document.activeElement.id") == "profile-email"
    page.click(".profile-dlg .profile-continue")
    assert not page.is_checked("#profile-understand"), "the tick isn't remembered"
    page.check("#profile-understand")
    page.click(".profile-without")
    page.wait_for_selector("#profile-link")
    assert "only way back in" in page.inner_text(".profile-dlg")
    made = [d for p_, d in site.intake.posts if p_ == "/profile"][-1]
    assert made["email"] == ""
    key = page.input_value("#profile-link").split("#", 1)[1]
    page.click(".profile-dlg .btn.primary")
    page.wait_for_function("() => !JSON.parse(localStorage.getItem('amble.done')).prefs_dirty")
    assert (site.intake.profiles[key]["prefs"] or {}).get("settings", {}).get("display_name") == "Max", "the display name goes to the profile"


def t_pin_on_a_new_device(site, catalog):
    key = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(22))
    m = catalog["missions"][2]
    site.intake.profiles[key] = {"done": {"r1": {"rid": "r1aaaa", "mission": m["full_id"], "slug": m["id"],
                                               "name": "A mission", "done_at": "2026-11-01T12:00:00Z", "snapshot": {}, "as_date": False,
                                               "rating": None, "note": "", "updated_at": "2026-11-01T12:00:00Z"}},
                                 "removed": [], "prefs": None, "email": True, "vault": {"wk": None, "we": None, "salt": None},
                                 "pin": "482913", "devices": set()}
    page = site.open("/me/#" + key)
    page.wait_for_selector(".profile-bar .me-pin-open")
    assert page.locator(".me-list li").count() == 0, "nothing comes in before the PIN"
    page.fill("#me-pin-open", "111222")
    page.click(".me-pin-open button[type=submit]")
    page.wait_for_selector(".pin-error:has-text('not the right PIN')")
    page.fill("#me-pin-open", "482913")
    page.click(".me-pin-open button[type=submit]")
    page.wait_for_selector(".profile-bar.is-saved")
    page.wait_for_selector(".me-list li")
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.profile')).device"), "this device keeps its token"


def t_settings_pin_and_devices(site, catalog):
    page = site.open("/me/settings/")
    key = give_profile(site, page)
    page.wait_for_selector(".me-pin-add")
    page.wait_for_function("() => !!JSON.parse(localStorage.getItem('amble.profile')).device")
    page.click(".me-pin-add")
    page.fill("#me-pin-new", "1234")
    page.fill("#me-pin-again", "1234")
    assert page.locator(".pin-four").is_visible(), "4 digits: 6 is safer"
    page.click(".me-pin-form button[type=submit]")
    page.wait_for_selector(".me-security .form-status.bad:has-text('too easy')")
    page.fill("#me-pin-new", "5823")
    page.fill("#me-pin-again", "5832")
    page.click(".me-pin-form button[type=submit]")
    page.wait_for_selector(".me-security .form-status.bad:has-text(\"don't match\")")
    page.fill("#me-pin-again", "5823")
    page.click(".me-pin-form button[type=submit]")
    page.wait_for_selector(".me-security .form-status.bad:has-text('I understand')")   # no recovery email: the caution first
    page.check("#me-pin-understand")
    page.click(".me-pin-form button[type=submit]")
    page.wait_for_selector(".me-pin-change")
    assert site.intake.profiles[key]["pin"] == "5823"
    site.intake.profiles[key]["devices"].add("o" * 22)
    page.click(".me-devices-show")
    page.wait_for_selector(".device-list li")
    assert page.locator(".device-list li").count() == 2 and "This device" in page.inner_text(".device-list")
    page.click(".me-signout-others")
    page.wait_for_function("() => document.querySelectorAll('.device-list li').length === 1")
    assert len(site.intake.profiles[key]["devices"]) == 1


def t_messages_red_dot_and_reply(site, catalog):
    page = site.open("/me/")
    key = give_profile(site, page)
    now = datetime.now(timezone.utc)
    site.intake.profiles[key]["messages"] = {
        "c7": {"ref": "c7", "kind": "contact", "label": "Message", "title": "Winter pack?", "first_line": "Is there a winter pack?",
               "status": "Waiting on you", "created_at": (now - timedelta(days=2)).isoformat(), "last_at": now.isoformat(), "unread": True,
               "closed": False, "closed_at": None, "leaves_at": None,
               "thread": [{"who": "them", "at": (now - timedelta(days=2)).isoformat(), "body": "Is there a winter pack?"},
                          {"who": "us", "at": now.isoformat(), "body": "Not yet, but soon!"}]},
        "s3": {"ref": "s3", "kind": "idea", "label": "Suggestion", "title": "Lava caves", "first_line": "Great in winter",
               "status": "Declined", "created_at": (now - timedelta(days=100)).isoformat(), "last_at": (now - timedelta(days=85)).isoformat(),
               "unread": False, "closed": True, "closed_at": (now - timedelta(days=85)).isoformat(), "leaves_at": (now + timedelta(days=5)).isoformat(),
               "thread": [{"who": "them", "at": (now - timedelta(days=100)).isoformat(), "body": "Great in winter"}]}}
    page.evaluate("() => { const p = JSON.parse(localStorage.getItem('amble.profile')); p.last = 0; localStorage.setItem('amble.profile', JSON.stringify(p)); }")
    page.reload()
    page.wait_for_selector(".top .nav-profile .nav-dot.is-reply", state="visible")
    assert "1 new reply" in page.inner_text(".top .nav-profile .sr")
    page.click(".top .nav-profile")
    page.wait_for_selector(".profile-menu a[href='/me/messages/'] .nav-dot.is-reply")
    page.click(".profile-menu a[href='/me/messages/']")
    page.wait_for_selector(".msg-list li")
    assert page.locator(".msg-list li").count() == 2 and "is-unread" in page.get_attribute(".msg-list li >> nth=0", "class")
    closed = page.inner_text(".msg-list li.is-closed")
    assert "removed in 5 days" in closed and page.locator(".msg-list li.is-closed .msg-countdown.is-soon").count() == 1, closed
    page.click(".msg-list a[href='#c7']")
    page.wait_for_selector(".msg-thread li >> nth=1")
    assert "AmbleBee" in page.inner_text(".msg-thread .msg-us") and "Not yet, but soon!" in page.inner_text(".msg-thread")
    page.fill("#msg-reply", "Thanks!")
    page.click(".msg-reply button[type=submit]")
    page.wait_for_function("() => document.querySelectorAll('.msg-thread li').length === 3")
    page.click(".msg-back a")
    page.wait_for_selector(".msg-list li")
    page.wait_for_selector(".top .nav-profile .nav-dot.is-reply", state="hidden")
    page.click(".msg-list a[href='#s3']")
    page.wait_for_selector(".msg-about")
    assert "removed from Messages" in page.inner_text(".msg-about") and page.locator("#msg-reply").count() == 0
    assert "Start a new message" in page.inner_text(".messages-app")


def t_display_name_fills_in_the_forms(site, catalog):
    page = site.open("/contact/")
    give_profile(site, page)
    # let the new profile's first sync (and its notes key) finish: a reload mid-request is reported by WebKit as an
    # "access control" error, which isn't one
    page.wait_for_function("() => { const p = JSON.parse(localStorage.getItem('amble.profile') || 'null'); return p && p.last > 0 && p.dk; }")
    page.evaluate("AmbleDone.setSettings({ display_name: 'Max' })")
    page.wait_for_function("() => !JSON.parse(localStorage.getItem('amble.done')).prefs_dirty")
    page.reload()
    page.wait_for_selector(".intake-form", state="visible")
    assert page.input_value("#contact-name") == "Max", "the display name fills in the contact name"
    assert "Filled in from your profile" in page.inner_text(".intake-form")
    page.goto(site.base + "/suggest/idea/")
    page.wait_for_selector(".intake-form", state="visible")
    assert page.input_value(".intake-form input[name=name]") == "Max", "and the suggestion form's"


def t_forms_sign_in_box_and_link(site, catalog):
    page = site.open("/contact/")
    page.wait_for_selector(".intake-form", state="visible")
    assert page.locator(".signin-box").is_visible(), "no profile: the sign-in box"
    page.click(".signin-skip")
    assert page.locator(".signin-box").count() == 0, "Continue without hides it"
    rep = site.open("/report/")
    rep.wait_for_selector(".intake-form", state="visible")
    assert rep.locator(".signin-box").count() == 0, "reports stay one tap away"
    key = give_profile(site, page)
    page.wait_for_selector(".intake-form", state="visible")
    assert page.locator(".signin-box").count() == 0 and "Linked to your profile" in page.inner_text(".signed-in-line")
    page.fill("#contact-name", "Max")
    page.fill("#contact-email", "max@example.com")
    page.fill("#contact-subject", "Hello")
    page.fill("#contact-message", "Is there a winter pack?")
    page.wait_for_timeout(1200)                                   # the bot check wants a person-sized pause
    page.click(".intake-form button[type=submit]")
    page.wait_for_selector(".intake-done", state="visible")
    sent = [h for p_, h in site.intake.headers if p_ == "/contact"][-1]
    assert sent.get("authorization") == "Profile " + key and sent.get("x-amble-device"), sent

# ---------- branch 3: votes with friends (calendar-voting-PLAN.md §3) ----------

def t_start_a_vote_from_a_mission(site, catalog):
    m1, m2 = catalog["missions"][2], catalog["missions"][3]
    page = site.open(f"/missions/{m1['id']}/")
    key = give_profile(site, page)
    page.click(".plan-slot .vote-start")
    page.wait_for_selector(".vote-builder")
    assert m1["name"] in page.inner_text(".vote-picks"), "the mission comes along"
    page.fill("#v-search", m2["name"][:6])
    page.click(f".vote-add:has-text('{m2['name']}')")
    page.fill("#v-name", "4th of July plans")
    page.fill("#v-day", "2027-07-04")
    page.dispatch_event("#v-day", "change")
    page.click(".vote-go")
    page.wait_for_selector(".vote-shared #vote-link")
    v = list(site.intake.votes.values())[-1]
    assert v["creator"] == key and [o["mission"] for o in v["options"]] == [m1["full_id"], m2["full_id"]], v["options"]
    assert v["sent"]["for_date"] == "2027-07-04" and v["sent"]["hours"] == 24 and v["sent"]["names_public"] is True
    assert page.input_value("#vote-link").endswith("/vote/?v=" + v["pub"]), "the link keeps the vote where apps like Discord can't drop it"
    assert page.evaluate("JSON.parse(localStorage.getItem('amble.vote.draft'))") is None, "the draft is cleared once it starts"


def t_vote_then_the_results_become_a_plan(site, catalog):
    m1, m2 = catalog["missions"][2], catalog["missions"][3]
    page = site.open("/")
    owner = give_profile(site, page)
    pub = "Vtestvote0000001"
    site.intake.votes[pub] = {"pub": pub, "kind": "friends", "style": "pick", "name": "Saturday plans", "for_date": "2026-01-03",
                              "status": "open", "closes_at": (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat(),
                              "profiles_only": False, "names_public": True, "creator": owner, "started_by": "Max", "ballots": {},
                              "options": [{"id": 1, "mission": m1["full_id"], "slug": m1["id"], "name": m1["name"], "place": "", "season": ["any"]},
                                          {"id": 2, "mission": m2["full_id"], "slug": m2["id"], "name": m2["name"], "place": "", "season": ["any"]}]}
    friend = site.open("/vote/#" + pub)
    friend.wait_for_selector(".vote-option")
    head = friend.inner_text(".vote-head")
    assert "You're invited to vote!" in head and "Saturday plans" in head and "Started by Max" in head, head
    assert friend.locator(".flip-clock .flip").count() == 3, "the flip-clock countdown"
    assert "0 people have voted" in friend.inner_text(".vote-count")
    friend.click(".vote-option >> nth=1 >> .vote-option-tap")
    friend.fill("#vote-name", "Sam")
    friend.click(".vote-cast")
    friend.wait_for_selector(".vote-in")
    token = friend.evaluate("JSON.parse(localStorage.getItem('amble.voter'))")
    assert site.intake.votes[pub]["ballots"][token] == {"choice": [2], "name": "Sam"}, site.intake.votes[pub]["ballots"]
    assert "Sam" in friend.inner_text(".vote-voted"), "Voted so far shows the name"
    friend.click(".vote-option >> nth=1 >> .vote-expand")
    assert friend.locator(".vote-option >> nth=1 >> .vote-more").is_visible(), "each mission opens for its details"
    site.intake.finish_vote(site.intake.votes[pub])
    friend.reload()
    friend.wait_for_selector(".podium")
    assert "And the winner is" in friend.inner_text(".vote-head") and m2["name"] in friend.inner_text(".vote-plan")
    plans = friend.evaluate("JSON.parse(localStorage.getItem('amble.done')).plans")
    assert any(p["source"] == "vote" and p["vote_id"] == pub and p["mission"] == m2["full_id"] for p in plans), "the winner is this voter's own plan"
    assert friend.locator(".vote-didyougo").count() == 1, "the day has passed: Did you go?"
    assert friend.evaluate(f"JSON.parse(localStorage.getItem('amble.votes')).find(x => x.pub === '{pub}').seen") is True, "the ended vote's been seen"


def t_put_it_to_a_vote_stamp(site, catalog):
    m = plan_mission(catalog)
    page = site.open(f"/missions/{m['id']}/")
    put_plan(page, m, -2, -2, "vvvvvv01")
    page.evaluate("""() => { const st = JSON.parse(localStorage.getItem('amble.done'));
        st.plans.forEach(p => { p.source = 'vote'; p.vote_id = 'Vtestvote0000003'; p.vote_name = 'Saturday plans'; });
        localStorage.setItem('amble.done', JSON.stringify(st)); }""")
    page.reload()
    page.wait_for_selector(".done-box .plan-ask-box")
    page.click(".plan-ask-box .plan-yes")
    page.wait_for_selector(".done-entry")
    assert page.evaluate("AmbleDone.list()[0].via") == "vote"
    earned = [s["id"] for s in page.evaluate("AmbleStamps.earned()")]
    assert "put-it-to-a-vote" in earned and "planned-ahead" not in earned, earned
    assert "Put It to a Vote" in page.inner_text(".done-box")


def t_share_a_vote_and_open_it_on_a_phone(site, catalog):
    m1, m2 = catalog["missions"][2], catalog["missions"][3]
    page = site.open("/")
    key = give_profile(site, page)
    pub = "Vtestvote0000004"
    site.intake.votes[pub] = {"pub": pub, "kind": "friends", "style": "pick", "name": "Game night", "for_date": "2027-01-09",
                              "status": "open", "closes_at": (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat(),
                              "profiles_only": False, "names_public": True, "creator": key, "ballots": {},
                              "options": [{"id": 1, "mission": m1["full_id"], "slug": m1["id"], "name": m1["name"], "place": "", "season": ["any"]},
                                          {"id": 2, "mission": m2["full_id"], "slug": m2["id"], "name": m2["name"], "place": "", "season": ["any"]}]}
    page.goto(site.base + "/vote/#" + pub)
    page.wait_for_selector(".vote-share")
    assert page.input_value("#vote-share-link").endswith("/vote/?v=" + pub), "anyone can copy the vote's link"
    page.click(".vote-qr-show")
    assert page.locator(".vote-share .vote-qr svg").count() == 1, "and show its QR code"
    page.click(".vote-phone-show")
    phone_link = page.input_value("#vote-phone-link")
    assert "/me/?next=" in phone_link and phone_link.endswith("#" + key) and page.locator(".vote-phone svg").count() == 1, phone_link
    phone = site.open("/about/")                                      # another device
    phone.goto(phone_link)
    phone.wait_for_url("**/vote/?v=" + pub)
    phone.wait_for_selector(".vote-share")
    assert phone.evaluate("JSON.parse(localStorage.getItem('amble.profile')).key") == key, "signed in on the phone"
    assert phone.locator(".vote-phone-show").count() == 1, "as the person who started it"
    friend = site.open("/vote/?v=" + pub)                                  # the link as shared now
    friend.wait_for_selector(".vote-share")
    assert friend.locator(".vote-phone-show").count() == 0, "friends get the vote's link, never the profile one"

    # Voted so far, for the person who started it: one line of names; a tap hides one (greyed here, gone for others)
    site.intake.votes[pub]["ballots"] = {"a": {"choice": [1], "name": "Max W"}, "b": {"choice": [2], "name": "Chelsie"},
                                         "c": {"choice": [1], "name": "LE"}, "d": {"choice": [2], "name": None}}
    page.reload()
    page.wait_for_selector(".vote-voted .voted-name")
    assert page.inner_text(".vote-voted .voted-line") == "Max W, Chelsie, LE, plus 1 other person", page.inner_text(".vote-voted .voted-line")
    page.click(".voted-name:has-text('LE')")
    page.wait_for_selector(".voted-name.is-hidden:has-text('LE')")
    assert page.get_attribute(".voted-name.is-hidden", "aria-pressed") == "true"
    friend.reload()
    friend.wait_for_selector(".vote-voted .voted-line")
    assert friend.inner_text(".vote-voted .voted-line") == "Max W, Chelsie, plus 2 other people", "others don't see a hidden name"


def t_votes_in_the_menu(site, catalog):
    page = site.open("/")
    page.evaluate("""localStorage.setItem('amble.votes', JSON.stringify([{ pub: 'Vtestvote0000002', name: 'Movie night', role: 'voter',
                     closes_at: new Date(Date.now() - 60000).toISOString() }]))""")
    page.reload()
    page.wait_for_selector(".top .nav-profile .nav-dot", state="visible")
    page.click(".top .nav-profile")
    page.wait_for_selector(".profile-menu a[href='/me/votes/'] .nav-dot")
    page.click(".profile-menu a[href='/me/votes/']")
    page.wait_for_selector(".vote-app .vote-row")
    assert "Movie night" in page.inner_text(".vote-app")


def t_header_stays_on_one_line(site, catalog):
    page = site.open("/about/", viewport={"width": 1000, "height": 700})
    page.wait_for_function("() => document.querySelectorAll('.top nav > a.is-folded').length > 0")
    brand = page.locator(".top .brand").bounding_box()
    nav = page.locator(".top nav").bounding_box()
    assert nav["y"] < brand["y"] + brand["height"] and nav["height"] < 64, "the links sit beside the logo, not on a line below"
    folded = page.eval_on_selector_all(".top nav > a.is-folded", "els => els.map(e => e.textContent)")
    assert "Bee trail" in folded, folded
    assert page.locator(".top .menu summary .menu-burger").is_visible(), "More shows its three lines"
    page.click(".top .menu summary")
    assert page.locator(".menu-panel a.is-folded:has-text('Bee trail')").is_visible(), "what didn't fit is in More"
    wide = site.open("/about/", viewport={"width": 1400, "height": 700})
    wide.wait_for_selector(".top nav > a")
    wide.wait_for_timeout(300)
    left = wide.eval_on_selector_all(".top nav > a.is-folded", "els => els.map(e => e.textContent)")
    assert left in ([], ["Bee trail"]), f"with room, everything (or all but the last) stays in the bar: {left}"   # browsers measure text a little differently

def t_contribute_page_polls(site, catalog):
    """AmbleBee's own polls live on Contribute, with suggesting a mission and a link to report a problem."""
    m1 = catalog["missions"][2]
    pub = "Opoll00000000001"
    site.intake.votes[pub] = {"pub": pub, "kind": "official", "style": "pick", "name": "Which pack next?", "for_date": None,
                              "status": "open", "closes_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
                              "profiles_only": False, "names_public": False, "creator": None, "ballots": {}, "allow_other": True,
                              "options": [{"id": 1, "mission": None, "slug": None, "name": "Montana", "place": None, "explain": "Big skies", "season": ["any"]},
                                          {"id": 2, "mission": m1["full_id"], "slug": m1["id"], "name": m1["name"], "place": "", "season": ["any"]}]}
    page = site.open("/contribute/")
    page.wait_for_selector(".poll-list a")
    assert page.locator(".suggest-paths a[href='/suggest/idea/']").count() == 1, "suggesting a mission moved here"
    assert page.locator("#report ~ .contact-paths a[href='/report/']").count() == 1, "report a problem is linked"
    v = site.intake.votes[pub]
    v["opens_at"] = (datetime.now(timezone.utc) + timedelta(hours=2, minutes=5, seconds=30)).isoformat()
    page.reload()
    page.wait_for_selector(".poll-list a")
    assert "Coming up" in page.inner_text(".poll-app"), "a scheduled poll is listed as coming up"
    page.click(".poll-list a:has-text('Which pack next?')")
    page.wait_for_selector(".poll-clock")
    clock = page.inner_text(".poll-clock")
    assert clock.startswith("Poll opens in 2 hours and 6 minutes"), clock
    assert page.locator(".vote-cast").count() == 0 and page.locator(".vote-option").count() == 2, "options shown, no voting yet"
    v["opens_at"] = None
    page.reload()
    page.wait_for_selector(".vote-option")
    assert page.inner_text(".poll-clock").startswith("Poll closes in 10 days"), page.inner_text(".poll-clock")
    head = page.inner_text(".vote-head")
    assert "AmbleBee poll" in head and "AmbleBee makes the final call" in head, head
    page.click(".vote-option >> nth=0 >> .vote-option-tap")
    page.fill("#poll-other", "Utah")
    page.click(".vote-cast")
    page.wait_for_selector(".vote-in")
    b = list(site.intake.votes[pub]["ballots"].values())[0]
    assert b["choice"] == [1] and b["other"] == "Utah", b
    v = site.intake.votes[pub]
    v.update(status="finished", result={"scores": [{"option": 1, "points": 1, "place": 1}, {"option": 2, "points": 0, "place": 2}], "voters": 1, "winner": 1},
             staff={"pick": 2, "reason": "Closer for most of you.", "decided_at": datetime.now(timezone.utc).isoformat()})
    page.reload()
    page.wait_for_selector(".poll-results")
    text = page.inner_text(".poll-results")
    assert "Montana" in text and ("Staff pick: " + m1["name"]) in text and "Closer for most of you." in text, text
    contact = site.open("/contact/")
    assert contact.locator(".contact-paths a[href='#message']").count() == 0, "no Send a message card: the form is right below"
    assert contact.locator(".contact-paths a[href='/report/']").count() == 1, "report a problem stays on Contact"



def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    if not (folder / "catalog.json").exists():
        raise SystemExit(f"No built site in {folder}. Run bash tools/preview.sh or the build steps first.")
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("t_")]
    only = os.environ.get("SMOKE_ONLY")   # e.g. SMOKE_ONLY=stamp runs just the tests with "stamp" in the name
    if only: tests = [(n, f) for n, f in tests if only in n]
    server = serve(folder)
    failed = []
    with sync_playwright() as p:
        engine = getattr(p, os.environ.get("SMOKE_ENGINE", "chromium"))
        browser = engine.launch(channel="chrome" if os.environ.get("SMOKE_CHROME") else None)
        site = Site(browser, f"http://127.0.0.1:{server.server_address[1]}")
        for name, fn in tests:
            label = re.sub(r"^t_", "", name).replace("_", " ")
            site.errors = []
            try:
                fn(site, catalog)
                if site.errors:
                    raise AssertionError("browser errors: " + "; ".join(sorted(set(site.errors))[:3]))
                print(f"  ok    {label}")
            except Exception as e:  # noqa: BLE001  every failure gets reported, not just the first
                failed.append(label)
                print(f"  FAIL  {label}\n        {str(e).splitlines()[0] if str(e) else type(e).__name__}")
                if os.environ.get("SMOKE_TRACE"):
                    import traceback; traceback.print_exc()
            for ctx in browser.contexts:
                ctx.close()
        browser.close()
    server.shutdown()
    if failed:
        raise SystemExit(f"{len(failed)} of {len(tests)} browser tests failed.")
    print(f"All {len(tests)} browser tests passed.")


if __name__ == "__main__":
    main()

