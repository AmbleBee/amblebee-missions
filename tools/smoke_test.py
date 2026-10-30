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
