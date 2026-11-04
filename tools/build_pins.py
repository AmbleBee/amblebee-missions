"""Turn every live mission into a tall Pinterest pin, plus a spreadsheet for Pinterest's bulk upload.

    python tools/build_pins.py                  # every live mission  -> _pins/
    python tools/build_pins.py --mode date      # only date ideas (date + "date or adventure")
    python tools/build_pins.py --pack oregon    # one state pack
    python tools/build_pins.py --media-base https://amblebee.com/pins

Each pin is 1000 x 1500 (Pinterest's 2:3 shape) in the site's own colors, fonts and pack icons: the pack and
place up top, the mission name big in the middle, the short line, time and cost chips, and amblebee.com at the bottom.

pins.csv sits next to the pictures, ready for Pinterest's bulk upload (Create > Create Pins in bulk). Its columns
are the ones Pinterest asks for: Title, Media URL, Pinterest board, Thumbnail, Description, Link, Publish date,
Keywords. Pinterest needs a public web address for each picture, so either upload the PNGs by hand and ignore
that column, or put them online somewhere (for example in site/pins/ so they're on amblebee.com) and pass that
address as --media-base. Every link carries utm_source=pinterest, so Google Analytics shows visits from Pinterest.

Needs Playwright (the same one the share cards and tests use): pip install playwright && playwright install chromium
_pins/ is in .gitignore, so the pictures never end up in the repo by accident.
"""
import argparse
import csv
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_cards import CSS as CARD_CSS, hive  # noqa: E402
from build_catalog import build  # noqa: E402
from build_icons import load as load_icons  # noqa: E402
from build_pages import BASE, COST, DURATION, MODE, state_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 1000, 1500
BOARD = "Date Ideas and Adventures"   # Pinterest board name for the CSV; change it with --board

esc = lambda v: html.escape(str(v), quote=True)  # noqa: E731

# Same paper, colors and fonts as the share cards; only the layout is new.
CSS = CARD_CSS.split(".card {")[0] + """
.pin { width: 1000px; height: 1500px; box-sizing: border-box; background: #EFE7D8; padding: 84px 80px 76px;
  display: flex; flex-direction: column; font-family: N; color: #5A3E2B; position: relative; overflow: hidden; }
.pin::after { content: ""; position: absolute; inset: 28px; border: 4px dashed #D9CDB6; border-radius: 44px; }
.badge { width: 150px; height: 150px; border-radius: 40px; background: #F6E6C6; color: #5A3E2B;
  display: grid; place-items: center; margin: 0 auto; }
.badge svg { width: 92px; height: 92px; }
.badge svg.hive { width: 108px; height: 108px; }
.eyebrow { text-align: center; font: 800 40px N; color: #566B48; margin-top: 30px; }
.where { text-align: center; font: 650 34px N; color: #7A5A42; margin-top: 6px; }
.mid { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; min-height: 0; }
.kicker { font: 700 56px C; color: #566B48; transform: rotate(-2deg); margin-bottom: 18px; }
h1 { font: 650 112px/1.04 F; color: #4A3323; margin: 0 0 34px; letter-spacing: -1px; }
p { font: 600 44px/1.35 N; margin: 0; max-width: 820px; }
.chips { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 44px; }
.chips span { background: #FFFDF8; box-shadow: inset 0 0 0 4px #D9CDB6; border-radius: 40px; padding: 12px 30px;
  font: 800 34px N; white-space: nowrap; }
.foot { display: flex; align-items: center; justify-content: center; gap: 16px; }
.foot b { font: 650 60px F; color: #4A3323; }
.url { text-align: center; font: 700 32px N; color: #7A5A42; margin-top: 8px; }
"""

# Shrink a long name until it fits on three lines, and the short line until it fits on four.
FIT = """() => {
  const h = document.querySelector("h1"), p = document.querySelector("p");
  let s = 112; while (s > 64 && h.scrollHeight > s * 1.04 * 3 + 6) { s -= 4; h.style.fontSize = s + "px"; }
  let t = 44; while (t > 32 && p.scrollHeight > t * 1.35 * 4 + 6) { t -= 2; p.style.fontSize = t + "px"; }
}"""

KICKER = {"date": "A date idea", "adventure": "An adventure", "both": "A date or adventure"}


def pin_html(m, pack, icons):
    badge_svg = icons["packs"].get(pack.get("icon"), "")
    badge = (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
             f'stroke-linejoin="round">{badge_svg}</svg>') if badge_svg else hive(108)
    place = m.get("place") or {}
    state = state_of(pack)
    where = ", ".join(x for x in (re.sub(r"\s*\([^)]*\)", "", place.get("area") or ""), state) if x) if place else "Do it anywhere"
    chips = "".join(f"<span>{esc(x)}</span>" for x in (DURATION[m["duration"]], COST[m["cost"]]))
    logo = hive(84).replace(' class="hive"', "")
    return (f'<div class="pin"><div class="badge">{badge}</div>'
            f'<div class="eyebrow">{esc(pack.get("name"))}</div><div class="where">{esc(where)}</div>'
            f'<div class="mid"><div class="kicker">{esc(KICKER.get(m["mode"], ""))}</div>'
            f'<h1>{esc(m["name"])}</h1><p>{esc(m["short"])}</p></div>'
            f'<div class="chips">{chips}</div>'
            f'<div class="foot">{logo}<b>AmbleBee</b></div>'
            '<div class="url">Find it on amblebee.com</div></div>'), where


def slug(text):
    """Alcatraz Island -> Alcatraz-Island (letters, numbers and dashes only, safe in any file system)."""
    return re.sub(r"[^A-Za-z0-9]+", "-", str(text)).strip("-")


def file_name(m, pack):
    """PACK_#_Title.png, e.g. Amble-California_023_Alcatraz-Island.png. The number is padded so files sort in order."""
    num = m.get("number")
    num = f"{int(num):03d}" if str(num).isdigit() else slug(num or "0")
    return f"{slug(pack.get('name') or m['pack'])}_{num}_{slug(m['name'])}.png"


def build_pins(out, mode=None, pack_id=None, media_base="", board=BOARD):
    catalog = build(ROOT / "missions")
    icons, problems = load_icons()
    if problems:
        raise SystemExit("Fix the icons first:\n  - " + "\n  - ".join(problems))
    packs = {p["id"]: p for p in catalog["packs"]}
    missions = [m for m in catalog["missions"]
                if (not mode or m["mode"] in ({"date", "both"} if mode == "date" else {mode, "both"}))
                and (not pack_id or m["pack"] == pack_id)]
    if not missions:
        raise SystemExit("No live missions match that.")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("Pins need Playwright: pip install playwright && playwright install chromium")

    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    fonts = (ROOT / "site" / "fonts").resolve().as_uri()
    shell = out / "_draw.html"
    shell.write_text(f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS.replace("FONTS", fonts)}'
                     'html,body{margin:0}</style></head><body><div id="c"></div></body></html>', encoding="utf-8")
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT})
        page.goto(shell.resolve().as_uri())
        for m in missions:
            pack = packs[m["pack"]]
            markup, where = pin_html(m, pack, icons)
            page.evaluate("h => { document.getElementById('c').innerHTML = h; }", markup)
            page.evaluate("() => document.fonts.ready")
            page.evaluate(FIT)
            name = file_name(m, pack)
            page.screenshot(path=str(out / name))
            short = str(m["short"]).strip()
            facts = " · ".join((MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]]))
            tags = [t for t in (m.get("tags") or []) if isinstance(t, str)]
            rows.append({
                "Title": f"{m['name']}, {where}"[:100] if where != "Do it anywhere" else m["name"][:100],
                "Media URL": f"{media_base.rstrip('/')}/{name}" if media_base else name,
                "Pinterest board": board,
                "Thumbnail": "",
                "Description": f"{short} {facts}. Open the mission on AmbleBee for photo ideas and tips."[:500],
                "Link": f"{BASE}/missions/{m['id']}/?utm_source=pinterest&utm_medium=social",
                "Publish date": "",
                "Keywords": ", ".join(t.replace("-", " ") for t in tags[:8]),
            })
        browser.close()
    shell.unlink()
    with open(out / "pins.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "_pins"))
    ap.add_argument("--mode", choices=["date", "adventure"], help="only date ideas, or only adventures")
    ap.add_argument("--pack", help="only one pack, by its id (e.g. oregon, anywhere)")
    ap.add_argument("--media-base", default="", help="public address where the PNGs will live, for the CSV")
    ap.add_argument("--board", default=BOARD, help="Pinterest board name for the CSV")
    args = ap.parse_args()
    n = build_pins(args.out, args.mode, args.pack, args.media_base, args.board)
    print(f"Drew {n} pins and pins.csv -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
