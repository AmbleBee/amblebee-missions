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
        self.mode, self.posts = "up", []

    def handle(self, route):
        req = route.request
        path = req.url.split(INTAKE, 1)[1].split("?")[0]
        cors = {"access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST",
                "access-control-allow-headers": "Content-Type", "content-type": "application/json"}
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
        if req.method == "POST":
            data = json.loads(req.post_data or "{}")
            self.posts.append((path, data))
            if path == "/submit/mission":
                m = data.get("mission") or {}
                if not m.get("name") or not m.get("description"):
                    return reply(400, {"ok": False, "error": "Please check the highlighted fields.", "errors": {"name": "Give the mission a name."}})
                return reply(201, {"ok": True, "token": "tok123", "status_url": "https://amblebee.com/status/#tok123"})
            need = {"/submit/idea": ["title", "body"], "/report": ["body"], "/contact": ["name", "email", "message"]}.get(path)
            if need is None:
                return reply(404, {"ok": False})
            errors = {f: "Please fill this in." for f in need if not str(data.get(f, "")).strip()}
            if errors:
                return reply(400, {"ok": False, "error": "Please check the highlighted fields.", "errors": errors})
            if path == "/contact" or (path == "/report" and not data.get("follow")):
                return reply(201, {"ok": True})
            return reply(201, {"ok": True, "token": "tok123", "status_url": "https://amblebee.com/status/#tok123"})
        if path == "/status/tok123":
            return reply(200, {"ok": True, "kind": "idea", "title": "Tide pools", "status": "in_review", "headline": "In review",
                               "text": "We're reading it now.", "closed": False, "created_at": "2026-11-12T16:00:00+00:00",
                               "steps": [{"status": s, "label": s} for s in ("awaiting", "in_review", "building", "approved", "live")],
                               "history": [{"status": "awaiting", "label": "Awaiting review", "at": "2026-11-12T16:00:00+00:00"}]})
        return reply(404, {"ok": False, "error": "not found"})


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
        for text in ("Every mission", "Search", "About", "Bee trail", "Know a great spot?", "Safety", "Privacy", "Contact"):
            assert page.locator(".menu-panel a", has_text=text).first.is_visible(), f"{text} missing on {path}"
        page.keyboard.press("Escape")
        assert not page.is_visible(".menu-panel")
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
    page.click('.top nav > a:has-text("Know a great spot?")')
    page.wait_for_url("**/suggest/")
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


def t_built_pages_load(site, catalog):
    mission = catalog["missions"][-1]
    for path in ("/roadmap.html", "/missions/", f"/packs/{mission['pack']}/", f"/missions/{mission['id']}/",
                 "/about/", "/safety/", "/privacy/", "/contact/", "/rainy-day-date-ideas/", "/at-home-date-ideas/",
                 "/free-date-ideas/", "/kid-friendly-adventures/"):
        page = site.open(path)
        page.wait_for_selector("h1")
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
    page = site.open("/suggest/")
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
    assert "First name and last initial" in page.inner_text("#idea-name-hint")
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
    page.wait_for_selector(".intake-done h2")
    assert "token" not in json.dumps(site.intake.posts[-1][1])


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


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    if not (folder / "catalog.json").exists():
        raise SystemExit(f"No built site in {folder}. Run bash tools/preview.sh or the build steps first.")
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("t_")]
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
            for ctx in browser.contexts:
                ctx.close()
        browser.close()
    server.shutdown()
    if failed:
        raise SystemExit(f"{len(failed)} of {len(tests)} browser tests failed.")
    print(f"All {len(tests)} browser tests passed.")


if __name__ == "__main__":
    main()
