"""Draw the share card for each mission, pack and idea page: the picture a text, Discord or Facebook shows
when someone shares that page's link.

    python tools/build_cards.py --out _site

tools/build_pages.py decides what each card says and writes the list to _site/cards/cards.json; this script
draws them as 1200x630 PNGs next to it, in a real browser (Playwright, the same one the tests use), so the
site's own fonts, colors and pack icons look exactly like the website. Run it after build_pages.py.

Each page links its card as cards/<name>.png?v=<fingerprint>. The fingerprint comes from the card's words and
from this file, so editing a mission's name or short line (or the look below) gives the card a new address,
and apps that cached the old picture fetch the new one. Without Playwright, preview.sh skips the cards and
the site still works; shared links then show no picture until the real deploy.
"""
import argparse
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 1200, 630

# Colors are the site's light theme (site/style.css); fonts are the self-hosted ones in site/fonts/.
CSS = """
@font-face { font-family: F; src: url("FONTS/fraunces.woff2"); font-weight: 100 900; }
@font-face { font-family: N; src: url("FONTS/nunito.woff2"); font-weight: 200 1000; }
@font-face { font-family: C; src: url("FONTS/caveat-700.woff2"); font-weight: 700; }
html, body { margin: 0; background: #EFE7D8; }
.card { width: 1200px; height: 630px; box-sizing: border-box; background: #EFE7D8; padding: 56px 66px 54px;
  display: flex; flex-direction: column; font-family: N; color: #5A3E2B; position: relative; overflow: hidden; }
.card::after { content: ""; position: absolute; inset: 22px; border: 3px dashed #D9CDB6; border-radius: 34px; }
.top { display: flex; align-items: center; gap: 24px; min-width: 0; }
.badge { flex: none; width: 104px; height: 104px; border-radius: 28px; background: #F6E6C6; color: #5A3E2B;
  display: grid; place-items: center; }
.badge svg { width: 62px; height: 62px; }
.badge svg.hive { width: 74px; height: 74px; }
.labels { min-width: 0; }
.eyebrow { font: 800 36px N; color: #566B48; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { font: 650 30px N; color: #7A5A42; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.corner { flex: none; margin-left: auto; padding-left: 20px; font: 700 48px C; color: #566B48; transform: rotate(-3deg); }
.mid { flex: 1; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
h1 { font: 650 96px/1.02 F; color: #4A3323; margin: 0 0 16px; letter-spacing: -1px; }
p { font: 600 38px/1.3 N; margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.foot { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.chips { display: flex; gap: 14px; }
.chips span { background: #FFFDF8; box-shadow: inset 0 0 0 3px #D9CDB6; border-radius: 30px; padding: 10px 24px;
  font: 800 30px N; white-space: nowrap; }
.note { font: 700 46px C; color: #566B48; padding-right: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.brand { display: flex; align-items: center; gap: 12px; flex: none; }
.brand b { font: 650 48px F; color: #4A3323; }
"""

# Shrinks a long title until it fits on two lines, so every name shows in full.
FIT = """() => {
  const h = document.querySelector("h1");
  let size = 96;
  while (size > 56 && h.scrollHeight > size * 1.02 * 2 + 4) { size -= 4; h.style.fontSize = size + "px"; }
}"""

esc = lambda v: html.escape(str(v), quote=True)  # noqa: E731


def hive(size):
    svg = (ROOT / "site" / "favicon.svg").read_text(encoding="utf-8")
    return svg.replace("<svg ", f'<svg class="hive" width="{size}" height="{size}" ', 1)


def card_html(c):
    """One card from its spec: badge (a pack icon's SVG markup, or "hive"), eyebrow, sub, corner, title, text,
    and either chips or a handwritten note at the bottom."""
    badge = hive(74) if c.get("badge") == "hive" else (
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
        f'stroke-linejoin="round">{c.get("badge", "")}</svg>')
    sub = f'<div class="sub">{esc(c["sub"])}</div>' if c.get("sub") else ""
    corner = f'<div class="corner">{esc(c["corner"])}</div>' if c.get("corner") else ""
    logo = hive(80).replace(' class="hive"', "")
    left = (f'<div class="chips">{"".join(f"<span>{esc(x)}</span>" for x in c["chips"])}</div>' if c.get("chips")
            else f'<div class="note">{esc(c.get("note", ""))}</div>')
    return (f'<div class="card"><div class="top"><div class="badge">{badge}</div>'
            f'<div class="labels"><div class="eyebrow">{esc(c["eyebrow"])}</div>{sub}</div>{corner}</div>'
            f'<div class="mid"><h1>{esc(c["title"])}</h1><p>{esc(c["text"])}</p></div>'
            f'<div class="foot">{left}<div class="brand">{logo}<b>AmbleBee</b></div></div></div>')


def look_version():
    """Changes whenever this file changes, so a new look also gives every card a new address."""
    import hashlib
    return hashlib.sha1(Path(__file__).read_bytes() + (ROOT / "site" / "favicon.svg").read_bytes()).hexdigest()[:6]


def build_cards(out):
    out = Path(out)
    listing = out / "cards" / "cards.json"
    if not listing.exists():
        raise SystemExit(f"No {listing}. Run tools/build_pages.py first.")
    cards = json.loads(listing.read_text(encoding="utf-8"))
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("Share cards need Playwright (see README.md).")
    fonts = (out / "fonts").resolve().as_uri()
    shell = out / "cards" / "_draw.html"
    shell.write_text(f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS.replace("FONTS", fonts)}</style>'
                     '</head><body><div id="c"></div></body></html>', encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
        page.goto(shell.resolve().as_uri())
        for c in cards:
            page.evaluate("h => { document.getElementById('c').innerHTML = h; }", card_html(c))
            page.evaluate("() => document.fonts.ready")
            page.evaluate(FIT)
            page.screenshot(path=str(out / "cards" / f"{c['name']}.png"))
        browser.close()
    shell.unlink()
    listing.unlink()   # only needed to draw them; the pages already point at the pictures
    return len(cards)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args()
    n = build_cards(args.out)
    print(f"Drew {n} share cards -> {args.out}/cards/")


if __name__ == "__main__":
    sys.exit(main())
