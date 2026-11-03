"""Build plain web pages for search engines and shared links, from the live missions only.

    python tools/build_pages.py --out _site

Writes, inside the built site:
    missions/index.html          every pack, with its first few missions (like the home page) and a Show all link
    <collection>/index.html      missions gathered by idea ("Rainy Day Date Ideas"), from collections.yaml
    packs/<pack>/index.html      one pack's missions, under its icon, description and long "about" text
    missions/<id>/index.html     one mission, with its own title, preview, structured data and nearby missions
    about/, safety/, privacy/, contact/  written in pages/, wrapped in the same header and footer
    404.html                     shown by GitHub Pages for any address that doesn't exist
    sitemap.xml, robots.txt      with each page's last-changed date from git, when there's a full checkout
    cards/cards.json             what each share card says; tools/build_cards.py then draws them

Finally it adds a version to every script and stylesheet link (style.css?v=1a2b...), so visitors get new
files as soon as a deploy lands. Drafts never get a page. URLs use the mission id, which is permanent (SCHEMA.md), so moving a mission
to another pack doesn't break its link. Runs after the site is copied; a failure here stops the deploy.
"""
import argparse
import datetime
import hashlib
import html
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, urlencode

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_cards import look_version  # noqa: E402
from build_catalog import build  # noqa: E402
from build_icons import load as load_icons  # noqa: E402
from missions_lib import load_catalog  # noqa: E402

BASE = "https://amblebee.com"
SITE_NAME = "AmbleBee"
PACK_PREVIEW = 4   # missions per pack on /missions/, the same as PACK_PREVIEW in site/js/browse.js
NEARBY = 3         # "More missions nearby" at the bottom of each mission page: one full row on a computer
META_MAX = 158     # Google cuts search snippets off at about this many characters
COLLECTION_MIN = 8 # a collection page (collections.yaml) is built and linked once it has this many live missions
NEARBY_KM = 160    # about 100 miles; past that, a mission page shows more from its own pack instead
OG_IMAGE = {"url": f"{BASE}/og-image.png?v=2",   # for pages without their own share card; the same as site/index.html
            "alt": "AmbleBee: date ideas and adventures near you. A sealed envelope with a honey wax seal, and a bee flying off to deliver it"}
CSP = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com; connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com; object-src 'none'; base-uri 'self'; form-action 'self'"  # also in site/index.html and site/roadmap.html; the Google hosts are for the optional stats in site/js/stats.js
# the same "Report a problem" form as site/js/core.js: opens with the mission's id and name already filled in
REPORT_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSesllGRZbJaA4nINHJnwgmJxMIFX4z1aI88puOSOCUmzrnfHQ/viewform"
REPORT_FIELDS = {"id": "entry.872618061", "name": "entry.160884926"}
INFO_PAGES = {   # pages/<name>.html holds the words; edit those, not this
    "about": ("About", "How AmbleBee started, where the missions came from, and where the camera and Hive are going."),
    "safety": ("Safety", "How to stay safe on an AmbleBee mission, and what's up to you."),
    "privacy": ("Privacy", "What AmbleBee keeps, what stays on your device, and what goes to Google or GitHub."),
    "contact": ("Contact", "How to reach AmbleBee: report a problem, suggest a place, or ask for a change."),
}

# the small line above the title on each info page's share card
CARD_EYEBROW = {"about": "Our story", "safety": "Before you go", "privacy": "Your info", "contact": "Say hello"}

# the same wording as the labels at the top of site/js/core.js
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


def nav_html(current=""):
    """The one site menu, on every page: links on computers with a More menu, one Menu button on phones."""
    home = current == "index"
    main = [("/about/", "About"), ("/#browse" if home else "/missions/", "Every mission"), ("/#search", "Search"),
            ("/roadmap.html", "Bee trail"), ("/#share", "Know a great spot?")]
    if not home:
        main.insert(0, ("/", "Open a mission"))
    extra = [("/safety/", "Safety"), ("/privacy/", "Privacy"), ("/contact/", "Contact")]

    def link(href, text, cls=""):
        cls = " nav-share" if cls != "phone-only" and text.startswith("Know") else cls
        here = ' aria-current="page"' if (href, current) in (("/roadmap.html", "roadmap"), ("/about/", "about")) else ""
        attr = f' class="{cls.strip()}"' if cls else ""
        return f'<a href="{href}"{attr}{here}>{text}</a>'
    burger = ('<svg class="menu-burger" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="2.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>')
    return (f'<nav aria-label="Main">{"".join(link(h, t) for h, t in main)}'
            f'<details class="menu"><summary>{burger}<span class="menu-phone">Menu</span><span class="menu-wide">More</span></summary>'
            f'<div class="menu-panel">{"".join(link(h, t, "phone-only") for h, t in main)}{"".join(link(h, t) for h, t in extra)}</div>'
            '</details></nav>')


def page(title, description, path, main, jsonld, brand, extra_script="", current="", image=None):
    url = BASE + path
    image = image or OG_IMAGE
    data = json.dumps(jsonld, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="theme-color" content="#EFE7D8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#211B16" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="{esc(url)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:url" content="{esc(url)}">
<meta property="og:image" content="{esc(image["url"])}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(image["alt"])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{esc(image["url"])}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script src="/nav.js" defer></script>
<script src="/js/stats.js" defer></script>
<link rel="stylesheet" href="/fonts/fonts.css">
<link rel="stylesheet" href="/style.css">
<script type="application/ld+json">{data}</script>
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
  {brand}
  {nav_html(current)}
</header>
<main id="main">
{main}
</main>
<footer class="foot">
  <p class="foot-links"><a href="/about/">About</a> <a href="/missions/">Every mission by pack</a> <a href="/safety/">Safety</a> <a href="/privacy/">Privacy</a> <a href="/contact/">Contact</a></p>
  <p>Missions are shared under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>. Check hours, tickets and conditions before you go; places change.</p>
</footer>
{extra_script}</body>
</html>
"""


def crumbs_ld(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i, "name": name, "item": BASE + path}
        for i, (name, path) in enumerate(items, 1)]}


def card(href, top, title, short, meta, level=2):
    tags = "".join(f"<span>{esc(t)}</span>" for t in meta)
    return (f'<a class="card" href="{esc(href)}"><span class="card-top"><span class="no">{esc(top)}</span></span>'
            f'<h{level}>{esc(title)}</h{level}><p class="s">{esc(short)}</p><span class="meta">{tags}</span></a>')


def mission_html(m, pack, icons, today):
    """The ticket, in the same markup as ticket() in site/js/ticket.js, with the title as the page's h1."""
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

    report = REPORT_FORM + "?" + urlencode({"usp": "pp_url", REPORT_FIELDS["id"]: m["full_id"], REPORT_FIELDS["name"]: m["name"]})
    report_html = (f'<p class="report">Closed, moved or something off? '
                   f'<a href="{esc(report)}" target="_blank" rel="noopener">Report a problem</a></p>')
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
    {checked_html(m)}{report_html}
  </div>
</article>"""


UI_ICON = {   # the same artwork as ICON in site/js/core.js
    "share": '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
    "download": '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
}



def checked_html(m):
    """"Checked November 2026": when the place, hours and pin were last confirmed (the same line as site/js/ticket.js)."""
    d = re.fullmatch(r"(\d{4})-(\d{2})-\d{2}", str(m.get("checked") or ""))
    if not d:
        return ""
    month = datetime.date(int(d.group(1)), int(d.group(2)), 1).strftime("%B %Y")
    return f'<p class="checked">{icon(UI_ICON["check"], 16)}Checked {month}</p>\n    '


def welcome_html(pack, pack_path, live, collections):
    """A short "New to AmbleBee?" box on every mission page, for people who land there straight from Google
    or a shared link and have never seen the rest of the site."""
    more = (f'<a class="btn" href="{esc(pack_path)}">More in {esc(pack.get("name"))}</a>' if pack["id"] != "anywhere"
            else '<a class="btn" href="/missions/">Every mission</a>')
    return f"""<section class="welcome" aria-labelledby="welcome-title">
  <h2 id="welcome-title">New to AmbleBee?</h2>
  <p>AmbleBee hands you date and adventure ideas, one mission at a time: a real place or a fun plan, a little
  challenge, and a few photos to take along the way. There are {live} live missions so far, and each one is checked
  before it goes live.</p>
  <div class="welcome-actions"><a class="btn primary" href="/">Open a mission</a>{more}</div>
  {ideas_html(collections)}
</section>"""


def version_files(out):
    """Add ?v=<content hash> to script and stylesheet links, so a new file is fetched as soon as it's deployed."""
    names = ["style.css", "roadmap.css", "roadmap.js", "arrive.js", "until.js", "nav.js"]
    names += [f"js/{f.name}" for f in sorted((out / "js").glob("*.js"))]
    versions = {n: hashlib.sha256((out / n).read_bytes()).hexdigest()[:10] for n in names}
    links = re.compile(r'((?:href|src)="/?)(' + "|".join(map(re.escape, names)) + r')"')
    for f in out.rglob("*.html"):
        text = f.read_text(encoding="utf-8")
        f.write_text(links.sub(lambda m: f'{m.group(1)}{m.group(2)}?v={versions[m.group(2)]}"', text), encoding="utf-8")


def state_of(pack):
    """The state a pack covers ("Oregon"), or None for Amble Anywhere and other packs that aren't one place."""
    region = str(pack.get("region") or "").strip()
    return None if pack.get("id") in ("anywhere", "general") or region.lower() in ("", "anywhere") else region


def pack_heading(pack):
    """What people actually search for, used as the pack page's title."""
    state = state_of(pack)
    return f"Date & Adventure Ideas in {state}" if state else "Date & Adventure Ideas You Can Do Anywhere"


def km_between(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1, h)))


def git_dates():
    """Path (relative to the repo) -> the date it last changed, from one git log. Empty outside a full checkout,
    and then the sitemap simply leaves the dates out."""
    try:
        out = subprocess.run(["git", "log", "--format=@%cs", "--name-only", "--", "missions", "pages", "roadmap.yaml", "collections.yaml"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return {}
    dates, day = {}, None
    for line in out.splitlines():
        if line.startswith("@"):
            day = line[1:]
        elif line.strip() and day:
            dates.setdefault(line.strip(), day)   # newest commit first, so the first date seen is the latest
    return dates


def nearby_missions(m, missions):
    """The closest other missions with a place, within NEARBY_KM; or, failing that, the next ones in its own pack."""
    c = (m.get("place") or {}).get("coords")
    if c:
        near = sorted(((km_between(c, o["place"]["coords"]), o) for o in missions
                       if o is not m and (o.get("place") or {}).get("coords")), key=lambda x: x[0])
        near = [o for d, o in near if d <= NEARBY_KM][:NEARBY]
        if near:
            return near, "More missions nearby"
    same = sorted((o for o in missions if o["pack"] == m["pack"] and o is not m), key=lambda o: o["number"])
    after = [o for o in same if o["number"] > m["number"]] + [o for o in same if o["number"] < m["number"]]
    return after[:NEARBY], "More missions like this" if m["pack"] == "anywhere" else "More from this pack"


def matches(m, rule):
    """True when the mission fits every field in rule (collections.yaml). A list means any of these values;
    a list field on the mission (who) matches when it includes one of them."""
    for key, want in (rule or {}).items():
        want = want if isinstance(want, list) else [want]
        have = m.get(key)
        have = have if isinstance(have, list) else [have]
        if not set(map(str, want)) & set(map(str, have)):
            return False
    return True


def load_collections(missions):
    """collections.yaml with each collection's live missions; ones below COLLECTION_MIN are left out until they grow."""
    f = ROOT / "collections.yaml"
    if not f.exists():
        return []
    out = []
    for c in yaml.safe_load(f.read_text(encoding="utf-8")) or []:
        for key in ("id", "title", "label", "match", "description", "intro"):
            if not c.get(key):
                raise SystemExit(f"collections.yaml: '{c.get('id', '?')}' needs {key}")
        rows = [m for m in missions if matches(m, c["match"]) and not (c.get("exclude") and matches(m, c["exclude"]))]
        if len(rows) >= COLLECTION_MIN:
            out.append({**c, "missions": rows, "path": f"/{c['id']}/"})
    return out


def ideas_html(collections, cls="ideas"):
    """The "Browse by idea" row of links to the collection pages."""
    if not collections:
        return ""
    links = "".join(f'<a href="{c["path"]}">{esc(c["label"])}</a>' for c in collections)
    return f'<nav class="{cls}" aria-label="Browse by idea"><span>Browse by idea</span>{links}</nav>'


def build_pages(out):
    catalog = build(ROOT / "missions")
    icons, problems = load_icons()
    if problems:
        raise SystemExit("Not building pages, fix the icons first:\n  - " + "\n  - ".join(problems))
    brand = re.search(r'<a class="brand".*?</a>', (ROOT / "site" / "index.html").read_text(encoding="utf-8"), re.S).group(0)
    brand = brand.replace('href="./"', 'href="/"')
    today = datetime.date.today().isoformat()
    pack_about = {pid: str(pk.get("about") or "").strip() for pid, pk in load_catalog(ROOT / "missions")[1].items()}
    dates = git_dates()
    lastmod = {}   # page path -> date, for the sitemap
    until_script = '<script src="/until.js" defer></script>\n'

    missions = catalog["missions"]
    packs = sorted(catalog["packs"], key=lambda p: (p["id"] != "anywhere", p.get("name") or p["id"]))
    by_id = {p["id"]: p for p in packs}
    stats = catalog["stats"]
    collections = load_collections(missions)
    in_collections = {}   # mission id -> the collections it's in, for "Also in" on its page
    for c in collections:
        for m in c["missions"]:
            in_collections.setdefault(m["id"], []).append(c)
    urls = ["/", "/roadmap.html", "/missions/"]
    to_draw = []   # what each share card says, for tools/build_cards.py
    look = look_version()

    def share_card(name, alt, **spec):
        """Lists a card to draw and returns its address. The ?v= changes whenever the words or the look do."""
        spec["name"] = name
        to_draw.append(spec)
        v = hashlib.sha1((json.dumps(spec, sort_keys=True) + look).encode("utf-8")).hexdigest()[:8]
        return {"url": f"{BASE}/cards/{name}.png?v={v}", "alt": alt}

    def write(path, text):
        f = Path(out) / path.strip("/") / "index.html"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
        urls.append(path)

    def mission_card(m, level=2, with_pack=False):
        area = (m.get("place") or {}).get("area")
        top = f"{by_id[m['pack']].get('name')} · Mission {m['number']}" if with_pack else f"Mission {m['number']}" + (f" · {area}" if area else "")
        return card(f"/missions/{m['id']}/", top, m["name"], m["short"],
                    [MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]]], level)

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
        others, others_title = nearby_missions(m, missions)
        nearby_html = (f'<section class="nearby" aria-labelledby="nearby-title"><h2 id="nearby-title">{others_title}</h2>'
                       f'<div class="cards">{"".join(mission_card(o, 3, with_pack=True) for o in others)}</div></section>'
                       if others else "")
        also = in_collections.get(m["id"], [])
        also_links = " · ".join(f'<a href="{c["path"]}">{esc(c["title"])}</a>' for c in also)
        also_html = f'<p class="also-in">Also in: {also_links}</p>' if also else ""
        main = f"""<div class="page">
<p class="crumbs"><a href="/missions/">Every mission</a> › <a href="{esc(pack_path)}">{esc(pack.get("name"))}</a></p>
{mission_html(m, pack, icons, today)}
<div class="ticket-actions">
  <a class="btn primary" href="{esc(app_link)}&amp;do=card">{icon(UI_ICON["share"], 20)}Share this mission</a>
  <a class="btn" href="{esc(app_link)}&amp;do=save">{icon(UI_ICON["download"], 20)}Save as image</a>
  <a class="btn" href="/">Open a different mission</a>
</div>
{also_html}
{welcome_html(pack, pack_path, stats["live"], collections)}
{nearby_html}
</div>"""
        # "Multnomah Falls, Columbia River Gorge, Oregon": the place and the state are what people search for
        state = state_of(pack)
        where = ", ".join(x for x in (place.get("area"), state) if x and x != m["name"])
        title = f"{m['name']}, {where} · {SITE_NAME}" if where else f"{m['name']} · {SITE_NAME}"
        facts = " · ".join(x for x in (MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]], where) if x)
        short = str(m["short"]).strip()
        short = short if short[-1:] in ".!?" else short + "."
        desc = f"{short} {facts}."
        if len(desc) > META_MAX:   # too long for the search snippet: drop the place, then all the facts
            desc = f"{short} " + " · ".join(x for x in (MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]])) + "."
        if len(desc) > META_MAX:
            desc = short
        image = share_card(f"mission-{m['id']}", f"{m['name']}: {short}", badge=icons["packs"].get(pack.get("icon"), ""),
                           eyebrow=pack.get("name"), sub=re.sub(r"\s*\([^)]*\)", "", where) if place else "Do it anywhere",
                           corner=f"Mission {m['number']}", title=m["name"], text=short,
                           chips=[MODE[m["mode"]], DURATION[m["duration"]], COST[m["cost"]]])
        write(path, page(title, desc, path, main, ld, brand, until_script if 'data-until="' in main else "", image=image))
        f = dates.get(f"missions/{m['pack']}/{m['id']}.yaml")
        if f:
            lastmod[path] = f

    for p in packs:
        path = f"/packs/{p['id']}/"
        rows = sorted((m for m in missions if m["pack"] == p["id"]), key=lambda m: m["number"])
        cards = "".join(mission_card(m) for m in rows)
        desc = str(p.get("description") or f"Date and adventure missions in {p.get('region') or p.get('name')}.")
        # the long description (pack.yaml "about", written with "about: >"): a blank line there starts a new paragraph
        long_html = "".join(f"<p>{esc(' '.join(par.split()))}</p>" for par in pack_about.get(p["id"], "").split("\n") if par.strip())
        state = state_of(p)
        count_line = (f"{len(rows)} date and adventure {'idea' if len(rows) == 1 else 'ideas'} in {state}" if state
                      else f"{len(rows)} date and adventure {'idea' if len(rows) == 1 else 'ideas'} you can do anywhere")
        main = f"""<div class="page page-wide">
<p class="crumbs"><a href="/missions/">Every mission</a></p>
<div class="pack-head"><span class="badge badge-lg">{icon(icons["packs"].get(p.get("icon"), ""), 34)}</span>
<div><h1>{esc(p.get("name"))}</h1><p>{esc(desc)}</p></div></div>
{f'<div class="pack-about">{long_html}</div>' if long_html else ""}
<p class="hand">{esc(count_line)}</p>
<div class="cards">{cards}</div>
</div>"""
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": BASE + path, "url": BASE + path, "name": p.get("name"), "description": desc},
            crumbs_ld([("Every mission", "/missions/"), (p.get("name"), path)])]}
        meta = next((d for d in (f"{desc} {count_line}, picked and checked by AmbleBee.", f"{desc} {count_line}.")
                     if len(d) <= META_MAX), desc)
        image = share_card(f"pack-{p['id']}", f"{p.get('name')}: {desc}", badge=icons["packs"].get(p.get("icon"), ""),
                           eyebrow="Date & adventure ideas", title=p.get("name"), text=desc,
                           note=f"{len(rows)} ideas" + (f" in {state}" if state else " you can do anywhere"))
        write(path, page(f"{pack_heading(p)} · {p.get('name')}", meta, path, main, ld, brand, image=image))
        days = [lastmod[f"/missions/{m['id']}/"] for m in rows if f"/missions/{m['id']}/" in lastmod]
        days += [d for d in [dates.get(f"missions/{p['id']}/pack.yaml")] if d]
        if days:
            lastmod[path] = max(days)

    for c in collections:   # missions gathered by idea, grouped by pack (Amble Anywhere first)
        rows = c["missions"]
        groups = []
        for p in packs:
            ms = sorted((m for m in rows if m["pack"] == p["id"]), key=lambda m: m["number"])
            if ms:
                groups.append(
                    f'<section class="pack" aria-label="{esc(p.get("name"))}"><div class="pack-head">'
                    f'<span class="badge">{icon(icons["packs"].get(p.get("icon"), ""), 26)}</span>'
                    f'<div><h2><a href="/packs/{p["id"]}/">{esc(p.get("name"))}</a></h2>'
                    f'<p>{len(ms)} {"idea" if len(ms) == 1 else "ideas"}</p></div></div>'
                    f'<div class="cards">{"".join(mission_card(m, 3) for m in ms)}</div></section>')
        intro_html = "".join(f"<p>{esc(' '.join(par.split()))}</p>" for par in str(c["intro"]).split("\n") if par.strip())
        states = sum(1 for p in packs if p["id"] not in ("anywhere", "general") and any(m["pack"] == p["id"] for m in rows))
        count_line = f"{len(rows)} ideas" + (f" in {states} {'state' if states == 1 else 'states'}" if states else " you can do anywhere") + \
            (" and anywhere" if any(m["pack"] == "anywhere" for m in rows) and states else "")
        others = [o for o in collections if o is not c]
        main = f"""<div class="page page-wide">
<p class="crumbs"><a href="/missions/">Every mission</a></p>
<div class="page-intro"><h1>{esc(c["title"])}</h1></div>
<div class="pack-about">{intro_html}</div>
<p class="hand ideas-count">{esc(count_line)}</p>
{"".join(groups)}
{ideas_html(others, "ideas ideas-more")}
</div>"""
        # the search snippet: the collection's own description, with the count when there's room
        meta = " ".join(str(c["description"]).split())
        if len(f"{meta} {count_line}.") <= META_MAX:
            meta = f"{meta} {count_line}."
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": BASE + c["path"], "url": BASE + c["path"], "name": c["title"], "description": meta},
            crumbs_ld([("Every mission", "/missions/"), (c["title"], c["path"])])]}
        image = share_card(f"idea-{c['id']}", f"{c['title']}: {' '.join(str(c['description']).split())}", badge="hive",
                           eyebrow="Ideas from AmbleBee", title=c["title"], text=" ".join(str(c["description"]).split()),
                           note=count_line)
        write(c["path"], page(f"{c['title']} · {len(rows)} Ideas · AmbleBee", meta, c["path"], main, ld, brand, image=image))
        days = [lastmod[f"/missions/{m['id']}/"] for m in rows if f"/missions/{m['id']}/" in lastmod]
        if dates.get("collections.yaml"):
            days.append(dates["collections.yaml"])
        if days:
            lastmod[c["path"]] = max(days)

    sections = []
    for p in packs:   # the same taste of each pack as the home page: its first missions, then its own page
        rows = sorted((m for m in missions if m["pack"] == p["id"]), key=lambda m: m["number"])
        if not rows:
            continue
        more = len(rows) - PACK_PREVIEW
        link = f"/packs/{p['id']}/"
        sections.append(
            f'<section class="pack preview" aria-label="{esc(p.get("name"))}"><div class="pack-head">'
            f'<span class="badge">{icon(icons["packs"].get(p.get("icon"), ""), 26)}</span>'
            f'<div><h2><a href="{link}">{esc(p.get("name"))}</a></h2><p>{esc(p.get("description") or "")}</p></div></div>'
            f'<div class="cards">{"".join(mission_card(m, 3) for m in rows[:PACK_PREVIEW])}</div>'
            + (f'<a class="pack-more" href="{link}">{more} more · Show all {len(rows)}</a>' if more > 0 else "")
            + "</section>")
    intro = f"{stats['live']} live missions in {len(packs)} packs, with {stats['drafts']} more being checked."
    main = f"""<div class="page page-wide">
<div class="page-intro"><h1>Every mission</h1><p>{esc(intro)}</p></div>
{ideas_html(collections)}
{"".join(sections)}
</div>"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "url": f"{BASE}/missions/", "name": "Every mission", "description": intro}
    (Path(out) / "missions").mkdir(parents=True, exist_ok=True)
    (Path(out) / "missions" / "index.html").write_text(
        page(f"Every mission · {SITE_NAME}", intro, "/missions/", main, ld, brand,
             image=share_card("page-missions", f"Every mission: {intro}", badge="hive", eyebrow="Date & adventure ideas",
                              title="Every mission", text=intro, note="amblebee.com/missions")), encoding="utf-8")

    for name, (title, desc) in INFO_PAGES.items():
        path = f"/{name}/"
        body = (ROOT / "pages" / f"{name}.html").read_text(encoding="utf-8")
        main = f'<div class="page info">\n{body}</div>'
        ld = {"@context": "https://schema.org", "@type": "WebPage", "url": BASE + path, "name": title, "description": desc}
        image = share_card(f"page-{name}", f"{title}: {desc}", badge="hive", eyebrow=CARD_EYEBROW.get(name, "AmbleBee"),
                           title=title, text=desc, note=f"amblebee.com/{name}")
        write(path, page(f"{title} · {SITE_NAME}", desc, path, main, ld, brand, current=name, image=image))
        if dates.get(f"pages/{name}.html"):
            lastmod[path] = dates[f"pages/{name}.html"]

    body = (ROOT / "pages" / "404.html").read_text(encoding="utf-8")
    text = page(f"Page not found · {SITE_NAME}", "This page doesn't exist on AmbleBee.", "/404.html",
                f'<div class="page info">\n{body}</div>', {"@context": "https://schema.org", "@type": "WebPage", "name": "Page not found"}, brand)
    (Path(out) / "404.html").write_text(text.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1), encoding="utf-8")

    newest = max(lastmod.values(), default=None)
    for u in ("/", "/missions/"):
        if newest:
            lastmod[u] = newest
    if dates.get("roadmap.yaml"):
        lastmod["/roadmap.html"] = dates["roadmap.yaml"]
    sitemap = "".join(f"<url><loc>{esc(BASE + u)}</loc>" + (f"<lastmod>{lastmod[u]}</lastmod>" if u in lastmod else "") + "</url>"
                      for u in urls)
    (Path(out) / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sitemap}</urlset>\n',
        encoding="utf-8")
    trail = "What's new on AmbleBee, and what's coming next."   # the same as og:description in site/roadmap.html
    trail_card = share_card("page-roadmap", f"The Bee Trail: {trail}", badge="hive", eyebrow="Roadmap & changelog",
                            title="The Bee Trail", text=trail, note="amblebee.com/roadmap")
    (Path(out) / "cards").mkdir(parents=True, exist_ok=True)
    (Path(out) / "cards" / "cards.json").write_text(json.dumps(to_draw, ensure_ascii=False), encoding="utf-8")
    (Path(out) / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n", encoding="utf-8")
    for name, current in (("index.html", "index"), ("roadmap.html", "roadmap")):
        f = Path(out) / name
        text = f.read_text(encoding="utf-8").replace("<!--site-nav-->", nav_html(current)).replace("<!--ideas-->", ideas_html(collections))
        if name == "roadmap.html":   # the Bee trail gets its own share card; the home page keeps the envelope
            old = re.search(r'<meta property="og:image" content="[^"]*">', text)
            assert old, "site/roadmap.html lost its og:image line"
            text = text.replace(old.group(0), f'<meta property="og:image" content="{esc(trail_card["url"])}">\n'
                                '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
                                f'<meta property="og:image:alt" content="{esc(trail_card["alt"])}">\n'
                                f'<meta name="twitter:image" content="{esc(trail_card["url"])}">')
        f.write_text(text, encoding="utf-8")
    version_files(Path(out))
    return len(missions), len(packs), len(urls)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "_site"))
    args = ap.parse_args()
    n, p, u = build_pages(args.out)
    print(f"Built {n} mission pages, {p} pack pages and a sitemap of {u} addresses -> {args.out}")


if __name__ == "__main__":
    main()
