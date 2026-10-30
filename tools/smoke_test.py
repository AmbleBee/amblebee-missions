"""Open the built site in a real browser and try the things people actually do.

    python tools/smoke_test.py              # tests _site/
    python tools/smoke_test.py other/folder

Needs Playwright (see README.md). Set SMOKE_CHROME=1 to use an installed Google Chrome instead of
Playwright's Chromium. Any failure, or any error in the browser console, exits with an error,
which stops the deploy.
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


class Site:
    """A fresh page for each test. Motion is reduced so envelopes open right away."""

    def __init__(self, browser, base):
        self.browser, self.base, self.errors = browser, base, []

    def open(self, path="/", viewport=DESKTOP):
        ctx = self.browser.new_context(viewport=viewport, reduced_motion="reduce", accept_downloads=True)
        page = ctx.new_page()
        page.set_default_timeout(TIMEOUT_MS)
        page.on("pageerror", lambda e: self.errors.append(f"{path}: {e}"))
        page.on("console", lambda m: self.errors.append(f"{path}: {m.text}") if m.type == "error" else None)
        page.goto(self.base + path)
        return page

    def home(self, path="/", viewport=DESKTOP):
        page = self.open(path, viewport)
        page.wait_for_selector("#packs .card", state="attached")
        return page


def t_home_lists_every_live_mission(site, catalog):
    page = site.home()
    assert page.locator("#packs .card").count() == len(catalog["missions"])
    assert f"{len(catalog['missions'])} live missions" in page.inner_text("#browse-count")


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
    total = page.locator("#packs .card").count()
    page.click("#filters-toggle")
    page.click('[data-filter="cost"] label:has(input[value="free"])')
    narrowed = page.locator("#packs .card").count()
    assert 0 < narrowed < total
    assert "fit your filters" in page.inner_text("#browse-count")
    page.click("#browse-clear")
    assert page.locator("#packs .card").count() == total


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
    page.click('button:has-text("Share without a note")')
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


def t_who_is_coming_widens_and_skips_romantic(site, catalog):
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


def t_gift_link_from_a_popup_points_home(site, catalog):
    page = site.home()
    page.click("#packs .card")
    page.click('#dialog-body button:has-text("Share this mission")')
    page.click('button:has-text("Share without a note")')
    page.wait_for_selector(".gift-link")
    assert re.search(r":\d+/#gift=", page.input_value(".gift-link"))


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
    assert page.title() == "AmbleBee Missions"


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
    page.wait_for_selector("text=Near your location")
    assert "lat" not in page.url and "45." not in page.url
    assert page.locator('text="Remember on this device"').count() == 0


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


def t_menu_links_keep_filters_and_leave_a_mission(site, catalog):
    page = site.home("/?cost=free")
    page.click('.top nav > a[href="/#about"]')
    assert "cost=free" in page.url
    page.click("#roll-btn")
    page.wait_for_selector("#reveal-title")
    page.click('.top nav > a[href="/#about"]')
    page.wait_for_selector("#about", state="visible")


def t_footer_is_dark_on_short_pages_too(site, catalog):
    page = site.open("/contact/", {"width": 1280, "height": 1600})
    box = page.locator(".foot").bounding_box()
    assert box["y"] + box["height"] >= 1599, "the footer should reach the bottom of a short page"
    assert page.evaluate("getComputedStyle(document.querySelector('.foot')).backgroundColor") == "rgb(74, 51, 35)"


def t_built_pages_load(site, catalog):
    mission = catalog["missions"][-1]
    for path in ("/roadmap.html", "/missions/", f"/packs/{mission['pack']}/", f"/missions/{mission['id']}/",
                 "/safety/", "/privacy/", "/contact/"):
        page = site.open(path)
        page.wait_for_selector("h1")
    page = site.open(f"/missions/{mission['id']}/")
    assert mission["name"] in page.inner_text("h1")
    assert page.locator(".report a").count() == 1
    assert page.locator("a[href^='mailto:']").count() == 0
    page = site.open("/contact/")
    assert page.locator("a[href='mailto:staff@amblebee.com']").count() == 1


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    if not (folder / "catalog.json").exists():
        raise SystemExit(f"No built site in {folder}. Run bash tools/preview.sh or the build steps first.")
    catalog = json.loads((folder / "catalog.json").read_text(encoding="utf-8"))
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("t_")]
    server = serve(folder)
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome" if os.environ.get("SMOKE_CHROME") else None)
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
