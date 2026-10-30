"""Build plain web pages for search engines and shared links, from the live missions only.

    python tools/build_pages.py --out _site

Writes, inside the built site:
    missions/index.html          every pack
    packs/<pack>/index.html      one pack's missions
    missions/<id>/index.html     one mission, with its own title, preview and structured data
    sitemap.xml, robots.txt

Drafts never get a page. URLs use the mission id, which is permanent (SCHEMA.md), so moving a mission
to another pack doesn't break its link. Runs after the site is copied; a failure here stops the deploy.
"""
import argparse
import datetime
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_catalog import build  # noqa: E402
from build_icons import load as load_icons  # noqa: E402

BASE = "https://amblebee.com"
SITE_NAME = "AmbleBee Missions"
OG_IMAGE = f"{BASE}/og-image.png"

# the same wording as the labels at the top of site/app.js
MODE = {"date": "Date", "adventure": "Adventure", "both": "Date or adventure"}
DURATION = {"short": "1-3 hours", "half-day": "Half day", "all-day": "All day"}
EFFORT = {"easy": "Easy", "moderate": "Moderate", "hard": "Hard"}
COST = {"free": "Free", "$": "Under $20", "$$": "$20-60", "$$$": "Over $60"}
SETTING = {"indoor": "Indoors", "outdoor": "Outdoors", "either": "Indoors or out"}
TIME = {"morning": "Best in the morning", "daytime": "Daytime", "evening": "Best in the evening", "night": "At night"}
CHECK = {"hours": "opening hours", "tickets": "tickets", "reservation": "a reservation",
         "conditions": "weather and trail conditions", "seasonal": "whether it's open this season"}  # in display order
WHO = {"solo": "just you", "friends": "friends", "family": "family", "kids": "kids"}
DISCOUNT = {"senior": "seniors", "military": "military and veterans", "first-responder": "first responders",
            "healthcare": "healthcare workers", "educator": "teachers and educators", "student": "students",
            "government": "government employees", "local": "local residents", "birthday": "birthdays"}

esc = lambda v: html.escape(str(v), quote=True)  # noqa: E731


def join(parts):
    parts = list(parts)
    if len(parts) < 2:
        return "".join(parts)
    comma = ", and " if len(parts) > 2 or any(" and " in p for p in parts) else " and "
    return ", ".join(parts[:-1]) + comma + parts[-1]


def icon(markup, size):
    return (f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{markup}</svg>')


def page(title, description, path, main, jsonld, brand, extra_script=""):
    url = BASE + path
    data = json.dumps(jsonld, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#EFE7D8">
<link rel="canonical" href="{esc(url)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:image" content="{OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">{data}</script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
  {brand}
  <nav aria-label="Sections">
    <a href="/">Open a mission</a>
    <a href="/missions/">Every mission</a>
    <a href="/roadmap.html">Bee trail</a>
  </nav>
</header>
<main id="main">
{main}
</main>
<footer class="foot">
  <p>Missions are shared under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Check hours, tickets and conditions before you go; places change.</p>
</footer>
{extra_script}</body>
</html>
"""


def crumbs_ld(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": name, "item": BASE + path}
        for i, (name, path) in enumerate(items, 1)]}


def card(href, top, title, short, meta):
    tags = "".join(f"<span>{esc(t)}</span>" for t in meta)
    return (f'<a class="card" href="{esc(href)}"><span class="card-top"><span class="no">{esc(top)}</span></span>'
            f'<h2>{esc(title)}</h2><p class="s">{esc(short)}</p><span class="meta">{tags}</span></a>')


def mission_html(m, pack, icons, today):
    """The ticket, in the same markup as ticket() in site/app.js, with the title as the page's h1."""
    tags = [("sage", MODE[m["mode"]]), ("", DURATION[m["duration"]]), ("", EFFORT[m["effort"]]),
            ("", COST[m["cost"]]), ("", SETTING[m["setting"]])]
    if m.get("season") not in (None, "any"):
        tags.append(("honey", join(m["season"]).capitalize()))
    if m.get("time_of_day") in TIME:
        tags.append(("", TIME[m["time_of_day"]]))
    tag_html = "".join(f'<li{f" class={chr(34)}{c}{chr(34)}" if c else ""}>{esc(t)}</li>' for c, t in tags)

    notes = []
    if m.get("who"):
        notes.append("Good with " + join(WHO[w] for w in m["who"]))
    if m.get("check_ahead"):
        notes.append("Check before you go: " + join(CHECK[k] for k in CHECK if k in m["check_ahead"]))
    if m.get("discounts"):
        notes.append("Ask about discounts: " + join(DISCOUNT[k] for k in DISCOUNT if k in m["discounts"]))
    if m.get("gear"):
        items = lambda rent: [g["item"].replace("-", " ") for g in m["gear"] if g.get("rent", "no") == rent]  # noqa: E731
        bits = []
        if items("no"):
            bits.append("Bring " + join(items("no")))
        if items("on-site"):
            bits.append(("rent " if bits else "Rent ") + join(items("on-site")) + " there")
        if items("nearby"):
            bits.append(("rent " if bits else "Rent ") + join(items("nearby")) + " nearby")
        notes.append("; ".join(bits))
    notes_html = f'<div class="notes">{"".join(f"<p>{esc(n)}</p>" for n in notes)}</div>' if notes else ""

    # a caution that ends between builds is hidden by the small script on the page
    caution, until = str(m.get("caution") or "").strip(), m.get("caution_until")
    caution_html = ""
    if caution and not (until and until < today):
        attr = f' data-until="{esc(until)}"' if until else ""
        caution_html = f'<div class="caution" role="note" aria-label="Caution"{attr}><p>{esc(caution)}</p></div>'

    place_html = ""
    if m.get("place"):
        pl, links = m["place"], []
        c = pl.get("coords")
        if c:
            links.append(("Google Maps", f"https://www.google.com/maps/search/?api=1&query={c[0]},{c[1]}"))
            links.append(("Apple Maps", f"https://maps.apple.com/?ll={c[0]},{c[1]}&q={quote(pl.get('name') or m['name'])}"))
        if pl.get("website"):
            links.append(("Website", pl["website"]))
        links += [(x["label"], x["url"]) for x in (pl.get("links") or [])[:3]]
        area = f", {esc(pl['area'])}" if pl.get("area") else ""
        address = f"<span>{esc(pl['address'])}</span>" if pl.get("address") else ""
        buttons = "".join(f'<a href="{esc(u)}" target="_blank" rel="noopener">{esc(t)}</a>' for t, u in links)
        place_html = (f'<div class="place"><span><b>{esc(pl.get("name") or "")}</b>{area}</span>{address}'
                      f'<div class="links">{buttons}</div></div>')

    def extra(title, inner):
        return f'<details class="extra"><summary>{esc(title)}</summary><div class="inner">{inner}</div></details>'
    steps = lambda rows: "<ol>" + "".join(f"<li>{esc(s)}</li>" for s in rows) + "</ol>"  # noqa: E731
    extras = extra("Photo prompts along the way", steps(m["steps"])) if m.get("steps") else ""
    if "kids" in (m.get("who") or []) and m.get("for_kids"):
        kids = m["for_kids"]
        extras += extra("Kids' version", f'<p style="margin:0;font-weight:800">{esc(kids["short"])}</p>{steps(kids.get("steps") or [])}')

    credit = str(m.get("credit") or "").strip()
    credit_html = f'<p class="credit">Suggested by {esc(credit)}</p>' if credit else ""
    return f"""<article class="ticket">
  <div class="stub">{icon(icons["packs"].get(pack.get("icon"), ""), 34)}<span class="lbl">Mission</span><span class="num">{esc(m["number"])}</span></div>
  <div class="body">
    <h1>{esc(m["name"])}</h1>{credit_html}
    <p class="short">{esc(m["short"])}</p>
    <p class="desc">{esc(str(m["description"]).strip())}</p>
    <ul class="tags" aria-label="Details">{tag_html}</ul>
    {notes_html}{caution_html}{place_html}{extras}
  </div>
</article>"""


def build_pages(out):
    catalog = build(ROOT / "missions")
    icons, problems = load_icons()
    if problems:
        raise SystemExit("Not building pages, fix the icons first:\n  - " + "\n  - ".join(problems))
    brand = re.search(r'<a class="brand".*?</a>', (ROOT / "site" / "index.html").read_text(encoding="utf-8"), re.S).group(0)
    brand = brand.replace('href="./"', 'href="/"')
    today = datetime.date.today().isoformat()
    until_script = ('<script>(function(){var d=new Date(),t=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+'
                    'String(d.getDate()).padStart(2,"0");document.querySelectorAll("[data-until]").forEach(function(e){'
                    'if(t>e.dataset.until)e.remove();});})();</script>\n')

    missions = catalog["missions"]
    packs = sorted(catalog["packs"], key=lambda p: (p["id"] != "anywhere", p.get("name") or p["id"]))
    by_id = {p["id"]: p for p in packs}
    stats = catalog["stats"]
    urls = ["/", "/roadmap.html", "/missions/"]

    def write(path, text):
        f = Path(out) / path.strip("/") / "index.html"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
        urls.append(path)

    for m in missions:
        pack = by_id[m["pack"]]
        path, pack_path = f"/missions/{m['id']}/", f"/packs/{pack['id']}/"
        place = m.get("place") or {}
        about = {}
        if place:
            about = {"@type": "Place", "name": place.get("name"), "address": place.get("address")}
            if place.get("coords"):
                about["geo"] = {"@type": "GeoCoordinates", "latitude": place["coords"][0], "longitude": place["coords"][1]}
            if place.get("website"):
                about["url"] = place["website"]
            about = {"about": {k: v for k, v in about.items() if v}}
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebPage", "@id": BASE + path, "url": BASE + path, "name": m["name"], "description": m["short"],
             "isPartOf": {"@type": "WebSite", "name": SITE_NAME, "url": BASE + "/"}, **about},
            crumbs_ld([("Every mission", "/missions/"), (pack.get("name"), pack_path), (m["name"], path)])]}
        app_link = "/#mission=" + quote(m["full_id"], safe="") + "&from=page"
        main = f"""<div class="page">
<p class="crumbs"><a href="/missions/">Every mission</a> › <a href="{esc(pack_path)}">{esc(pack.get("name"))}</a></p>
{mission_html(m, pack, icons, today)}
<div class="ticket-actions">
  <a class="btn primary" href="{esc(app_link)}">Share or save this mission</a>
  <a class="btn" href="/">Open a different mission</a>
</div>
</div>"""
        where = f" in {place['area']}" if place.get("area") else ""
        write(path, page(f"{m['name']}{where} · {SITE_NAME}", m["short"], path, main, ld, brand,
                         until_script if 'data-until="' in main else ""))

    for p in packs:
        path = f"/packs/{p['id']}/"
        rows = [m for m in missions if m["pack"] == p["id"]]
        cards = "".join(card(f"/missions/{m['id']}/",
                             f"Mission {m['number']}" + (f" · {m['place']['area']}" if (m.get("place") or {}).get("area") else ""),
                             m["name"], m["short"], [MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]]]) for m in rows)
        desc = str(p.get("description") or f"Date and adventure missions in {p.get('region') or p.get('name')}.")
        main = f"""<div class="page page-wide">
<p class="crumbs"><a href="/missions/">Every mission</a></p>
<div class="pack-head"><span class="badge">{icon(icons["packs"].get(p.get("icon"), ""), 26)}</span>
<div><h1>{esc(p.get("name"))}</h1><p>{esc(desc)}</p></div></div>
<p class="hand">{len(rows)} live {"mission" if len(rows) == 1 else "missions"}</p>
<div class="cards">{cards}</div>
</div>"""
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": BASE + path, "url": BASE + path, "name": p.get("name"), "description": desc},
            crumbs_ld([("Every mission", "/missions/"), (p.get("name"), path)])]}
        write(path, page(f"{p.get('name')} · {SITE_NAME}", desc, path, main, ld, brand))

    cards = "".join(card(f"/packs/{p['id']}/", p.get("region") or "", p.get("name"), p.get("description") or "",
                         [f"{p['count']} live {'mission' if p['count'] == 1 else 'missions'}"]) for p in packs)
    intro = f"{stats['live']} live missions in {len(packs)} packs, with {stats['drafts']} more being checked."
    main = f"""<div class="page page-wide">
<div class="page-intro"><h1>Every mission</h1><p>{esc(intro)}</p></div>
<div class="cards">{cards}</div>
</div>"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "url": f"{BASE}/missions/", "name": "Every mission", "description": intro}
    (Path(out) / "missions").mkdir(parents=True, exist_ok=True)
    (Path(out) / "missions" / "index.html").write_text(
        page(f"Every mission · {SITE_NAME}", intro, "/missions/", main, ld, brand), encoding="utf-8")

    sitemap = "".join(f"<url><loc>{esc(BASE + u)}</loc></url>" for u in urls)
    (Path(out) / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sitemap}</urlset>\n',
        encoding="utf-8")
    (Path(out) / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n", encoding="utf-8")
    return len(missions), len(packs), len(urls)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args()
    n, p, u = build_pages(args.out)
    print(f"Built {n} mission pages, {p} pack pages and a sitemap of {u} addresses -> {args.out}")


if __name__ == "__main__":
    main()
