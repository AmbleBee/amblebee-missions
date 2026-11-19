"""Draws the two vote link-preview pictures from their sources, at 1200x630:
    tools/vote-preview.html          -> site/vote-preview.png          (AmbleBee polls: /poll/ and /contribute/)
    tools/vote-preview-friends.html  -> site/vote-preview-friends.png  (friends votes: /vote/)
They're the same for every poll and every vote, so they're drawn once and kept in site/. Run this after changing either source:
    python3 tools/draw_vote_previews.py
Needs Playwright's Chromium (pip install playwright, then python -m playwright install chromium)."""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAIRS = (("vote-preview.html", "vote-preview.png"), ("vote-preview-friends.html", "vote-preview-friends.png"))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630})
    for src, out in PAIRS:
        page.goto((ROOT / "tools" / src).as_uri())
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(300)   # the logo and the bee are images: let them land
        page.screenshot(path=str(ROOT / "site" / out))
        print("drew", out)
    browser.close()
