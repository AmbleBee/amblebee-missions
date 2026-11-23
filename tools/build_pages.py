"""Build plain web pages for search engines and shared links, from the live missions only.

    python tools/build_pages.py --out _site

Writes, inside the built site:
    missions/index.html          every pack, with its first few missions (like the home page) and a Show all link
    <collection>/index.html      missions gathered by idea ("Rainy Day Date Ideas"), from collections.yaml
    packs/<pack>/index.html      one pack's missions, under its icon, description and long "about" text
    missions/<id>/index.html     one mission, with its own title, preview, structured data and nearby missions
    about/, safety/, privacy/, contact/, suggest/, report/, status/  written in pages/, wrapped in the same header and footer
                                 (report/ and status/ are noindex and left out of the sitemap)
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
from missions_lib import MISSION_LINK, load_catalog  # noqa: E402

BASE = "https://amblebee.com"
SITE_NAME = "AmbleBee"
PACK_FOLD_MIN = 20   # packs with fewer live missions fold under "More packs" on /missions/
PACK_PREVIEW = 4   # missions per pack on /missions/
NEARBY = 3         # "More missions nearby" at the bottom of each mission page: one full row on a computer
META_MAX = 158     # Google cuts search snippets off at about this many characters
COLLECTION_MIN = 8 # a collection page (collections.yaml) is built and linked once it has this many live missions
NEARBY_KM = 160    # about 100 miles; past that, a mission page shows more from its own pack instead
OG_IMAGE = {"url": f"{BASE}/og-image.png?v=3",   # for pages without their own share card; the same as site/index.html
            "alt": "AmbleBee: date ideas and adventures near you. A sealed envelope with a honey wax seal, and a bee flying off to deliver it"}
CSP = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://amblebee-intake.tail58116.ts.net https://www.googletagmanager.com https://*.google-analytics.com; connect-src 'self' https://amblebee-intake.tail58116.ts.net https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com; object-src 'none'; base-uri 'self'; form-action 'self'"  # the Google hosts are for the optional stats in site/js/stats.js; amblebee-intake is the server behind the forms, profiles, votes and Field notes, whose photos it also serves (AmbleUtil.API in site/js/util.js)
# Every page's <head> starts with this: generated pages here, and site/index.html and site/roadmap.html at their
# <!--shared-head--> line, so the security policy and the site-wide scripts are written once. util.js comes first:
# the other scripts use its helpers.
SHARED_HEAD = (f'<meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
               '<script src="/nav.js" defer></script>\n'
               '<script src="/js/util.js" defer></script>\n'
               '<script src="/js/stats.js" defer></script>\n'
               '<script src="/js/count.js" defer></script>\n'
               '<script src="/js/current.js" defer></script>')   # the "On a mission" bar, on every page

# a pack page's filters and sorting (site/js/packfilter.js): the homepage's own rules from core.js and filters.js
PACK_FILTER_SCRIPTS = ('<script src="/js/core.js" defer></script>\n'
                       '<script src="/js/filters.js" defer></script>\n'
                       '<script src="/js/packfilter.js" defer></script>\n')

# the same "Report a problem" page as site/js/core.js: opens with the mission's id and name already filled in
REPORT_PAGE = "/report/"
INFO_PAGES = {   # pages/<name>.html holds the words; edit those, not this
    "about": ("About", "How AmbleBee started, where the missions came from, and where the camera and Hive are going."),
    "safety": ("Safety", "How to stay safe on an AmbleBee mission, and what's up to you."),
    "privacy": ("Privacy", "What AmbleBee keeps, what stays on your device, and what goes to Google or GitHub."),
    "contact": ("Contact", "How to reach AmbleBee: report a problem, suggest a place, or ask for a change."),
    "faq": ("Questions and answers", "Quick answers about AmbleBee missions, suggesting a place, what each status means, and your information."),
    "contribute": ("Contribute", "Vote in AmbleBee polls, suggest a mission, or report a problem."),
    "fieldnotes": ("Field notes", "The AmbleBee blog: mission round-ups, how the missions get made, and progress on the camera and the Hive."),
    "suggest": ("Suggest a mission", "Know a great date spot or adventure? Suggest it for AmbleBee and it might become a mission."),
    "suggest-idea": ("Share an idea", "Tell AmbleBee about a date spot or adventure you love, in your own words."),
    "suggest-mission": ("Build a mission", "Build a full AmbleBee mission step by step, with tips along the way."),
    "report": ("Report a problem", "Tell AmbleBee about a closed place, a wrong pin, or anything off with a mission."),
    "status": ("Submission status", "Check where your AmbleBee suggestion or report is at."),
    "me": ("Your profile", "Your AmbleBee stamp book and the missions you've marked done, kept on your own device."),
    "me-settings": ("Profile settings", "Your stamp details, missions set aside and a copy of your AmbleBee profile, kept on your own device."),
    "me-plans": ("My plans", "The missions you've added to your calendar, and whether you went."),
    "me-messages": ("Messages", "Your conversations with AmbleBee, with our replies."),
    "me-votes": ("Voting", "The votes you've started with friends, and the ones you've joined."),
    "poll": ("AmbleBee poll", "Help AmbleBee decide what comes next. Cast your vote!"),
    "vote": ("You're invited to vote!", "Help your crew pick the plan. Cast your vote!"),
    "vote-new": ("Start a vote", "Pick a few AmbleBee missions, send your friends a link, and everyone votes."),
}
WIDE_PAGES = {"contribute": "page-wide contribute", **{n: "page-wide pg" for n in ("about", "contact", "faq", "privacy", "safety")},
              "fieldnotes": "page-wide pg fieldnotes",
              **{n: "page-wide pg me-page" for n in ("me", "me-plans", "me-messages", "me-votes", "me-settings")}}   # laid out across the full width, not as a column of text
NOINDEX_PAGES = {"suggest", "report", "status", "me", "me-settings", "me-plans", "me-messages", "me-votes", "vote", "vote-new", "poll"}   # useful only through a link: kept out of search engines and the sitemap
PAGE_PATHS = {"suggest-idea": "/suggest/idea/", "suggest-mission": "/suggest/mission/", "me-settings": "/me/settings/", "me-plans": "/me/plans/", "me-messages": "/me/messages/", "me-votes": "/me/votes/", "vote": "/vote/", "vote-new": "/vote/new/", "poll": "/poll/"}   # pages/<name>.html → this address

# the small line above the title on each info page's share card
CARD_EYEBROW = {"about": "Our story", "safety": "Before you go", "privacy": "Your info", "contact": "Say hello", "faq": "Quick answers",
                "contribute": "Help shape AmbleBee", "fieldnotes": "The AmbleBee blog", "suggest": "Know a great spot?", "report": "Help keep it accurate", "status": "Your submission",
                "suggest-idea": "Know a great spot?", "suggest-mission": "Know a great spot?", "me": "Your profile", "me-settings": "Your profile", "me-plans": "Your profile", "me-messages": "Your profile", "me-votes": "Your profile", "vote": "Votes with friends", "vote-new": "Votes with friends", "poll": "AmbleBee poll"}

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
    main = [("/about/", "About"), ("/missions/", "Every mission"), ("/missions/all/#search", "Search"),
            ("/roadmap.html", "Bee trail"), ("/contribute/", "Contribute")]
    extra = [("/fieldnotes/", "Field notes"), ("/safety/", "Safety"), ("/privacy/", "Privacy"), ("/faq/", "FAQ"), ("/contact/", "Contact")]

    # When the links don't fit beside the logo, site/nav.js folds them into More, highest number first; 0 never folds
    FOLD = {"Bee trail": 5, "About": 4, "Search": 3, "Every mission": 2}

    def link(href, text, cls=""):
        cls = " nav-share" if cls != "phone-only" and text == "Contribute" else cls
        here = ' aria-current="page"' if (href, current) in (("/roadmap.html", "roadmap"), ("/about/", "about")) else ""
        attr = f' class="{cls.strip()}"' if cls else ""
        fold = f' data-fold="{FOLD[text]}"' if text in FOLD else ""
        return f'<a href="{href}"{attr}{fold}{here}>{text}</a>'
    burger = ('<svg class="menu-burger" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="2.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>')
    # Profile: your stamp book and missions (/me/) and their settings (/me/settings/), one tap away on every page.
    # It becomes the way into a saved profile in Phase 3 (claude/profiles-and-stamps-PLAN.md).
    mine = ' aria-current="page"' if current in ("me", "me-settings", "me-plans", "me-messages", "me-votes") else ""
    profile = (f'<a class="nav-profile" href="/me/" title="Profile"{mine}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" '
               'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
               '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/></svg><span class="sr">Profile</span></a>')
    return (f'<nav aria-label="Main">{"".join(link(h, t) for h, t in main)}{profile}'
            f'<details class="menu"><summary>{burger}<span class="menu-phone">Menu</span><span class="menu-wide">More</span></summary>'
            f'<div class="menu-panel">{"".join(link(h, t, "phone-only") for h, t in main)}{"".join(link(h, t) for h, t in extra)}</div>'
            '</details></nav>')


def faq_jsonld(body, path):
    """pages/faq.html as FAQPage data for search engines: each question is a <details class="faq-item">, its <summary>
    the question and its <div class="faq-a"> the answer."""
    strip = lambda t: " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())  # noqa: E731
    items = []
    for q, a in re.findall(r'<details class="faq-item"[^>]*>\s*<summary>(.*?)</summary>\s*<div class="faq-a">(.*?)</div>\s*</details>', body, re.S):
        answer = re.sub(r"\s+([.,:;!?])", r"\1", strip(a))
        items.append({"@type": "Question", "name": strip(q), "acceptedAnswer": {"@type": "Answer", "text": answer}})
    return {"@context": "https://schema.org", "@type": "FAQPage", "url": BASE + path, "mainEntity": items}


SHARED_BY_LINK = {"/poll/", "/vote/"}

# The link-preview pictures for polls and votes: the same for every poll and every vote, so they're drawn once
# (tools/vote-preview.html and tools/vote-preview-friends.html, by tools/draw_vote_previews.py) and kept in site/.
POLL_PIC = ("vote-preview.png", "AmbleBee poll: Your vote matters! Help us pick the next big thing. Three option cards, the first one ticked")
FRIENDS_PIC = ("vote-preview-friends.png", "You're invited to vote! Help your crew pick the plan. Three mission cards ranked 1st, 2nd and tap")
VOTE_PREVIEWS = {"poll": POLL_PIC, "contribute": POLL_PIC, "vote": FRIENDS_PIC, "vote-new": FRIENDS_PIC}


def page(title, description, path, main, jsonld, brand, extra_script="", current="", image=None):
    url = BASE + path
    if 'class="card"' in main and "/js/done.js" not in main + extra_script:
        extra_script += ('<script src="/js/done.js" defer></script>\n'      # the "Done" chip on cards of missions you've done
                         '<script src="/js/profile.js" defer></script>\n')  # kept up to date with the profile
    image = image or OG_IMAGE
    # pages shared with a ?p= or ?v= link: no og:url, so a link preview (Discord, iMessage) opens the poll or vote that was shared
    og_url = "" if path in SHARED_BY_LINK else f'<meta property="og:url" content="{esc(url)}">\n'
    data = json.dumps(jsonld, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
{SHARED_HEAD}
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
{og_url}<meta property="og:image" content="{esc(image["url"])}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(image["alt"])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{esc(image["url"])}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/favicon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
{footer_html()}
{extra_script}</body>
</html>
"""


# The one site footer, on every page (site/index.html and site/roadmap.html at their <!--site-footer--> line).
# build_pages() fills in the live count and date once the catalog is built.
FOOT = {"line": ""}
SOCIAL = [("Pinterest", "https://www.pinterest.com/AmbleBeeHQ/"), ("Bluesky", "https://bsky.app/profile/amblebeehq.bsky.social"),
          ("X", "https://x.com/AmbleBeeHQ"), ("GitHub", "https://github.com/AmbleBee/amblebee-missions")]


def footer_html():
    col = lambda title, links: (f'<nav class="foot-col" aria-label="{title}"><h2>{title}</h2>'
                                + "".join(f'<a href="{h}"{extra}>{t}</a>' for t, h, extra in links) + "</nav>")
    social = "".join(f'<a href="{h}" target="_blank" rel="me noopener" aria-label="AmbleBee on {t} (opens in a new tab)">{t}</a>' for t, h in SOCIAL)
    clock = ('<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
             'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>')
    return f"""<footer class="foot">
  <div class="foot-top">
    <div class="foot-brand"><a class="foot-logo" href="/" aria-label="AmbleBee, home"><img src="/logo.webp" alt="" width="540" height="179" loading="lazy"></a>
      <p class="foot-tag">A little nudge to get out the door together.</p></div>
    {col("Missions", [("Give me a mission", "/", ""), ("Every mission", "/missions/", ""), ("All in one list", "/missions/all/", ""),
                      ("Browse by vibe", "/#browse", ""), ("Suggest a mission →", "/contribute/#suggest", ' class="foot-suggest"')])}
    {col("AmbleBee", [("About", "/about/", ""), ("Contribute", "/contribute/", ""), ("Field notes", "/fieldnotes/", ""), ("Bee trail", "/roadmap.html", ""), ("FAQ", "/faq/", ""), ("Contact", "/contact/", "")])}
    <nav class="foot-col foot-social" aria-label="Follow along"><h2>Follow along</h2>{social}</nav>
  </div>
  <p class="foot-safe">{clock}<span>Check hours, tickets and conditions before you go. Places change.</span><a href="/safety/">Safety tips →</a></p>
  <div class="foot-bottom"><p>Missions are shared under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a><span id="catalog-meta">{FOOT["line"]}</span></p><p><a href="/privacy/">Privacy</a></p></div>
</footer>"""


# Your profile: one top for its five pages, with tabs between them (and metabs.js for the Plans count and the
# Messages dot). Each page keeps its own title; the line under it comes from the page itself.
ME_TABS = [("me", "/me/", "Stamps", "Your profile",
            '<circle cx="12" cy="12" r="8"/><path d="M12 7l1.5 3.2 3.5.4-2.6 2.3.8 3.4L12 14.6 8.8 16.3l.8-3.4L7 10.6l3.5-.4z"/>'),
           ("me-plans", "/me/plans/", "Plans", "My plans", '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
           ("me-messages", "/me/messages/", "Messages", "Messages", '<path d="M4 5h16v11H9l-5 4z"/>'),
           ("me-votes", "/me/votes/", "Votes", "Votes with friends", '<path d="M5 20v-6M12 20V5M19 20v-9"/>'),
           ("me-settings", "/me/settings/", "Settings", "Profile settings",
            '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>')]
ME_PAGES = {t[0] for t in ME_TABS}
CURRENT = ' aria-current="page"'


def profile_page(name, body):
    """A Your profile page: the shared top (title, its line, the tabs), then the page's own content on a band."""
    head = re.search(r'<h1>(.*?)</h1>', body, re.S)
    line = re.search(r'<p class="hand">(.*?)</p>', body, re.S) if name == "me" else re.search(r'</h1>\s*<p>(.*?)</p>', body, re.S)
    body = re.sub(r'<p class="crumbs">.*?</p>\s*', "", body, count=1, flags=re.S)
    if name == "me":
        body = re.sub(r'<div class="me-head">.*?</a>\s*</div>\s*', "", body, count=1, flags=re.S)   # the title, line and Settings button
    else:
        body = re.sub(r'<h1>.*?</h1>\s*<p>.*?</p>\s*', "", body, count=1, flags=re.S)
    title = next(t[3] for t in ME_TABS if t[0] == name)
    tabs = "".join(
        f'<a class="me-tab{" me-settings-link" if n == "me-settings" else ""}" data-tab="{label.lower()}" href="{href}"'
        f'{CURRENT if n == name else ""}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" '
        f'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{art}</svg>{label}'
        + ('<span class="me-tab-n" hidden></span>' if label == "Plans" else "")
        + ('<span class="me-tab-dot" hidden><span class="sr">New reply</span></span>' if label == "Messages" else "") + "</a>"
        for n, href, label, _, art in ME_TABS)
    return (f'<section class="pg-hero me-hero">\n  <p class="eyebrow">Your profile</p>\n  <h1>{title}</h1>\n'
            f'  <p class="hand">{line.group(1).strip() if line else ""}</p>\n'
            f'  <nav class="me-tabs" aria-label="Your profile">{tabs}</nav>\n</section>\n'
            f'<section class="pg-band me-band">\n{body.strip()}\n</section>\n')


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

    report = REPORT_PAGE + "?" + urlencode({"id": m["id"], "name": m["name"]})
    report_html = f'<p class="report">Closed, moved or something off? <a href="{esc(report)}">Report a problem</a></p>'
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
    <div class="plan-slot" data-plan="{esc(plan_info(m))}"></div>
    <div class="ticket-foot"><div>{checked_html(m)}{report_html}</div><div class="foot-acts"><span class="skip-slot" data-mission="{esc(m["full_id"])}"></span></div></div>
  </div>
</article>"""


def plan_info(m):
    """What "Add to calendar" needs (site/js/plans.js): the same fields catalog.json gives the mission popup."""
    keep = ("full_id", "id", "name", "short", "season", "duration", "gear",
            "pack", "mode", "setting", "time_of_day", "themes", "steps")   # the last ones are for Start mission (site/js/current.js)
    info = {k: m[k] for k in keep if m.get(k) is not None}
    if m.get("place"):
        info["place"] = {k: m["place"][k] for k in ("name", "address", "area", "coords") if m["place"].get(k)}
    return json.dumps(info, ensure_ascii=False, separators=(",", ":"))


def done_info(m):
    """What the "Mark done" box needs to know about a mission: the same fields site/js/done.js saves with each time
    it's done, so the stamps worked out later go by the mission as it was that day."""
    return json.dumps({"mission": m["full_id"], "slug": m["id"], "name": m["name"], "pack": m["pack"], "mode": m["mode"],
                       "setting": m.get("setting") or "either", "time_of_day": m.get("time_of_day") or "any",
                       "themes": m.get("themes") or []}, ensure_ascii=False, separators=(",", ":"))


UI_ICON = {   # the same artwork as ICON in site/js/core.js
    "share": '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
    "download": '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "book": '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5z"/><path d="M12 6.5v13"/>',
}



def checked_html(m):
    """"Checked November 2026": when the place, hours and pin were last confirmed (the same line as site/js/ticket.js)."""
    d = re.fullmatch(r"(\d{4})-(\d{2})-\d{2}", str(m.get("checked") or ""))
    if not d:
        return ""
    month = datetime.date(int(d.group(1)), int(d.group(2)), 1).strftime("%B %Y")
    return f'<p class="checked">{icon(UI_ICON["check"], 16)}Checked {month}</p>\n    '


def about_html(m, text, names, live):
    """The mission's about: background, facts and tips, website only (the Hive and camera get the short description).
    [[mission-id]] becomes a link to that mission's page, showing its name; a draft's name shows as plain text."""
    text = str(text or "").strip()
    if not text:
        return ""

    def link(found):
        mid = found.group(1)
        name = esc(names.get(mid, mid))
        return f'<a href="/missions/{mid}/">{name}</a>' if mid in live else name
    paras = "".join(f"<p>{MISSION_LINK.sub(link, esc(' '.join(p.split())))}</p>" for p in text.split("\n") if p.strip())
    title = "About this place" if m.get("place") else "More about this mission"
    head = f'<div class="about-head"><span class="about-icon">{icon(UI_ICON["book"], 24)}</span><h2 id="about-title">{esc(title)}</h2></div>'
    return f'<section class="mission-about" aria-labelledby="about-title">{head}{paras}</section>'


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


NEW_STATE_MISSIONS = 20   # below this many missions, a state page asks for help filling the map


def suggest_nudge(pack_id, state, count):
    """The note under a state's missions asking people to suggest one; none for packs that aren't one place."""
    if not state:
        return ""
    text = (f"We're just getting started in {state}. Help us fill the map!" if count < NEW_STATE_MISSIONS
            else f"Don't see your favorite place in {state}?")
    return (f'<aside class="suggest-nudge"><p>{esc(text)}</p>'
            f'<a class="btn primary small" href="/contribute/?pack={esc(pack_id)}#suggest">Add it as a mission →</a></aside>')


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


# the little pictures on the home page's "browse by vibe" cards, by collection id (collections.yaml). A new
# collection without one gets the heart.
VIBE_ICONS = {
    "rainy-day-date-ideas": '<path d="M7 15a4 4 0 0 1 .5-8A5.5 5.5 0 0 1 18 8.5a3.5 3.5 0 0 1-.5 6.5z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>',
    "at-home-date-ideas": '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    "free-date-ideas": '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    "kid-friendly-adventures": '<circle cx="9" cy="7" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5M15 15c2.6 0 4.6 1.6 5.4 4.5"/>',
}
VIBE_DEFAULT = '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'


VIBES_SHOWN = 4   # more vibe cards than this and they become a row that slides, with < and > buttons (site/js/main.js)


def vibes_html(collections):
    """The home page's "browse by vibe" cards: one per collection page, with its tagline. Up to VIBES_SHOWN fill
    the row; past that the cards get a little narrower, the next one peeks in, and < > move the row along
    (a swipe on phones)."""
    out = []
    for i, c in enumerate(collections):
        art = VIBE_ICONS.get(c["id"], VIBE_DEFAULT)
        tag = c.get("tagline") or f'{len(c["missions"])} ideas'
        out.append(f'<a class="vibe{" honey" if i % 2 else ""}" href="{c["path"]}"><span class="vibe-icon">'
                   f'<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
                   f'stroke-linecap="round" stroke-linejoin="round">{art}</svg></span><b>{esc(c["label"])}</b><span>{esc(tag)}</span></a>')
    if len(out) <= VIBES_SHOWN:
        return f'<div class="vibe-grid">{"".join(out)}</div>'
    arrow = lambda d, label, path: (f'<button type="button" class="vibe-nav {d}" aria-label="{label}" aria-controls="vibe-row">'
                                    f'<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                                    f'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="{path}"/></svg></button>')
    return (f'<div class="vibe-slider">{arrow("prev", "Previous vibes", "M15 5l-7 7 7 7")}'
            f'<div class="vibe-grid vibe-row" id="vibe-row" tabindex="0" aria-label="Vibes, {len(out)} of them">{"".join(out)}</div>'
            f'{arrow("next", "More vibes", "M9 5l7 7-7 7")}</div>')


# the All missions page (/missions/all/): a pack page's filters and sorting, plus search (site/js/search.js)
ALL_SCRIPTS = PACK_FILTER_SCRIPTS.replace('<script src="/js/packfilter.js"', '<script src="/js/search.js" defer></script>\n<script src="/js/packfilter.js"')


def ideas_html(collections, cls="ideas"):
    """The "Browse by vibe" row of links to the collection pages."""
    if not collections:
        return ""
    links = "".join(f'<a href="{c["path"]}">{esc(c["label"])}</a>' for c in collections)
    return f'<nav class="{cls}" aria-label="Browse by vibe"><span>Browse by vibe</span>{links}</nav>'


def build_pages(out):
    catalog = build(ROOT / "missions")
    icons, problems = load_icons()
    if problems:
        raise SystemExit("Not building pages, fix the icons first:\n  - " + "\n  - ".join(problems))
    brand = re.search(r'<a class="brand".*?</a>', (ROOT / "site" / "index.html").read_text(encoding="utf-8"), re.S).group(0)
    brand = brand.replace('href="./"', 'href="/"').replace('src="logo.webp"', 'src="/logo.webp"')
    today = datetime.date.today().isoformat()
    _, raw_packs, raw_missions = load_catalog(ROOT / "missions")   # the "about" texts are left out of catalog.json, so read them here
    pack_about = {pid: str(pk.get("about") or "").strip() for pid, pk in raw_packs.items()}
    mission_about = {rm["id"]: str(rm.get("about") or "").strip() for rm in raw_missions}
    mission_names = {rm["id"]: rm.get("name") or rm["id"] for rm in raw_missions}
    dates = git_dates()
    lastmod = {}   # page path -> date, for the sitemap
    until_script = '<script src="/until.js" defer></script>\n'
    done_script = ('<script src="/js/done.js" defer></script>\n'      # the "Mark done" box under each mission (site/js/done.js)
                   '<script src="/js/profile.js" defer></script>\n'   # and the free profile that keeps it safe (site/js/profile.js)
                   '<script src="/js/stamps.js" defer></script>\n'    # and the stamp that lands when one is earned (site/js/stamps.js)
                   '<script src="/js/plans.js" defer></script>\n')    # Add to calendar and "Did you go?" (site/js/plans.js)

    updated = (catalog.get("source") or {}).get("updated")
    try:
        when = datetime.date.fromisoformat(updated).strftime("%B %-d, %Y")
    except (TypeError, ValueError):
        when = ""
    FOOT["line"] = f' · {catalog["stats"]["live"]} live missions' + (f", updated {when}" if when else "")
    missions = catalog["missions"]
    live_ids = {m["id"] for m in missions}   # drafts aren't in the catalog, so a [[link]] to one stays plain text
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
<div class="done-slot" data-mission="{esc(done_info(m))}"></div>
{about_html(m, mission_about.get(m["id"]), mission_names, live_ids)}
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
        scripts = (until_script if 'data-until="' in main else "") + done_script
        write(path, page(title, desc, path, main, ld, brand, scripts, image=image))
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
<div class="pack-filters" data-pack="{esc(p["id"])}"></div>
<div class="cards pack-cards">{cards}</div>
{suggest_nudge(p["id"], state, len(rows))}
</div>"""
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "CollectionPage", "@id": BASE + path, "url": BASE + path, "name": p.get("name"), "description": desc},
            crumbs_ld([("Every mission", "/missions/"), (p.get("name"), path)])]}
        meta = next((d for d in (f"{desc} {count_line}, picked and checked by AmbleBee.", f"{desc} {count_line}.")
                     if len(d) <= META_MAX), desc)
        image = share_card(f"pack-{p['id']}", f"{p.get('name')}: {desc}", badge=icons["packs"].get(p.get("icon"), ""),
                           eyebrow="Date & adventure ideas", title=p.get("name"), text=desc,
                           note=f"{len(rows)} ideas" + (f" in {state}" if state else " you can do anywhere"))
        write(path, page(f"{pack_heading(p)} · {p.get('name')}", meta, path, main, ld, brand, image=image,
                         extra_script=PACK_FILTER_SCRIPTS))
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
                    f'<div class="cards pack-cards">{"".join(mission_card(m, 3) for m in ms)}</div></section>')
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
<div class="pack-filters" data-pack="all" data-search></div>
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
        write(c["path"], page(f"{c['title']} · {len(rows)} Ideas · AmbleBee", meta, c["path"], main, ld, brand, image=image,
                              extra_script=ALL_SCRIPTS))
        days = [lastmod[f"/missions/{m['id']}/"] for m in rows if f"/missions/{m['id']}/" in lastmod]
        if dates.get("collections.yaml"):
            days.append(dates["collections.yaml"])
        if days:
            lastmod[c["path"]] = max(days)

    # the same order as the home page: Amble Anywhere, the big packs (biggest first), then the small ones folded away
    live_count = {p["id"]: sum(1 for m in missions if m["pack"] == p["id"]) for p in packs}
    is_big = lambda p: p["id"] == "anywhere" or live_count[p["id"]] >= PACK_FOLD_MIN
    ordered = sorted(packs, key=lambda p: (p["id"] != "anywhere", not is_big(p), -live_count[p["id"]] if is_big(p) else 0))
    sections, folded, folded_missions = [], [], 0
    for p in ordered:   # the same taste of each pack as the home page: its first missions, then its own page
        rows = sorted((m for m in missions if m["pack"] == p["id"]), key=lambda m: m["number"])
        if not rows:
            continue
        here = sections if is_big(p) else folded
        folded_missions += 0 if is_big(p) else len(rows)
        more = len(rows) - PACK_PREVIEW
        link = f"/packs/{p['id']}/"
        here.append(
            f'<section class="pack preview" aria-label="{esc(p.get("name"))}"><div class="pack-head">'
            f'<span class="badge">{icon(icons["packs"].get(p.get("icon"), ""), 26)}</span>'
            f'<div><h2><a href="{link}">{esc(p.get("name"))}</a></h2><p>{esc(p.get("description") or "")}</p></div></div>'
            f'<div class="cards pack-cards">{"".join(mission_card(m, 3) for m in rows[:PACK_PREVIEW])}'
            f'{"".join(mission_card(m, 3).replace("<a class=", "<a data-extra hidden class=", 1) for m in rows[PACK_PREVIEW:])}</div>'
            + (f'<a class="pack-more" href="{link}">{more} more · Show all {len(rows)}</a>' if more > 0 else "")
            + "</section>")
    intro = f"{stats['live']} live missions in {len(packs)} packs, with {stats['drafts']} more being checked."
    more_packs = (f'<details class="more-packs"><summary><b>{len(folded)} more {"pack" if len(folded) == 1 else "packs"}</b>'
                  f'<span>{folded_missions} {"mission" if folded_missions == 1 else "missions"} in packs that are still growing</span></summary>'
                  f'{"".join(folded)}</details>') if folded else ""
    main = f"""<div class="page page-wide">
<div class="page-intro"><h1>Every mission</h1><p>{esc(intro)} <a href="/missions/all/">See all {stats['live']} in one list</a></p></div>
{ideas_html(collections)}
<div class="pack-filters" data-pack="all" data-search data-preview></div>
{"".join(sections)}
{more_packs}
</div>"""
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "url": f"{BASE}/missions/", "name": "Every mission", "description": intro}
    (Path(out) / "missions").mkdir(parents=True, exist_ok=True)
    (Path(out) / "missions" / "index.html").write_text(
        page(f"Every mission · {SITE_NAME}", intro, "/missions/", main, ld, brand, extra_script=ALL_SCRIPTS,
             image=share_card("page-missions", f"Every mission: {intro}", badge="hive", eyebrow="Date & adventure ideas",
                              title="Every mission", text=intro, note="amblebee.com/missions")), encoding="utf-8")

    # All missions: every live mission in one list (Amble Anywhere, then each state A to Z), with search, filters,
    # sorting and "Distance from" from site/js/packfilter.js. Without JavaScript it's the plain list.
    in_order = [m for p in packs for m in sorted((m for m in missions if m["pack"] == p["id"]), key=lambda m: m["number"])]
    states = len({state_of(p) for p in packs if state_of(p) and live_count[p["id"]]})
    all_intro = f"All {len(in_order)} live missions, from every state and the ones you can do anywhere, in one list."
    main = f"""<div class="page page-wide">
<p class="crumbs"><a href="/missions/">Every mission</a></p>
<div class="page-intro"><h1>All missions</h1><p>{esc(all_intro)} Want them by state instead? <a href="/missions/">Browse by state</a>.</p></div>
<p class="hand">{len(in_order)} missions in {states} states and anywhere</p>
<div class="pack-filters" data-pack="all" data-search></div>
<div class="cards pack-cards">{"".join(mission_card(m, with_pack=True) for m in in_order)}</div>
</div>"""
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": f"{BASE}/missions/all/", "url": f"{BASE}/missions/all/", "name": "All missions", "description": all_intro},
        crumbs_ld([("Every mission", "/missions/"), ("All missions", "/missions/all/")])]}
    write("/missions/all/", page(f"All missions · {SITE_NAME}", all_intro, "/missions/all/", main, ld, brand, extra_script=ALL_SCRIPTS,
                                 image=share_card("page-missions-all", f"All missions: {all_intro}", badge="hive", eyebrow="Date & adventure ideas",
                                                  title="All missions", text=all_intro, note="amblebee.com/missions/all")))

    for name, (title, desc) in INFO_PAGES.items():
        path = PAGE_PATHS.get(name, f"/{name}/")
        body = (ROOT / "pages" / f"{name}.html").read_text(encoding="utf-8")
        if name in ME_PAGES:
            body = profile_page(name, body) + '<script src="/js/metabs.js" defer></script>\n'
        main = f'<div class="page {WIDE_PAGES.get(name, "info")}">\n{body}</div>'
        ld = {"@context": "https://schema.org", "@type": "WebPage", "url": BASE + path, "name": title, "description": desc}
        if name == "faq":
            ld = faq_jsonld(body, path)
        if name in VOTE_PREVIEWS:   # drawn once from tools/vote-preview*.html (tools/draw_vote_previews.py)
            pic, alt = VOTE_PREVIEWS[name]
            v = hashlib.sha1((ROOT / "site" / pic).read_bytes()).hexdigest()[:8]
            image = {"url": f"{BASE}/{pic}?v={v}", "alt": alt}
        else:
            image = share_card(f"page-{name}", f"{title}: {desc}", badge="hive", eyebrow=CARD_EYEBROW.get(name, "AmbleBee"),
                               title=title, text=desc, note="amblebee.com" + path.rstrip("/"))
        text = page(f"{title} · {SITE_NAME}", desc, path, main, ld, brand, current=name, image=image)
        if name in NOINDEX_PAGES:
            f = Path(out) / path.strip("/") / "index.html"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1), encoding="utf-8")
            continue
        write(path, text)
        if dates.get(f"pages/{name}.html"):
            lastmod[path] = dates[f"pages/{name}.html"]

    body = (ROOT / "pages" / "404.html").read_text(encoding="utf-8")
    text = page(f"Page not found · {SITE_NAME}", "This page doesn't exist on AmbleBee.", "/404.html",
                f'<div class="page info">\n{body}</div>', {"@context": "https://schema.org", "@type": "WebPage", "name": "Page not found"}, brand)
    # Field notes posts are shown by this page too (site/js/fieldnotes.js), so a shared post's link preview reads as
    # AmbleBee rather than "Page not found". The tab's own title still says what happened.
    for old, new in ((f"Page not found · {SITE_NAME}", SITE_NAME), ("This page doesn't exist on AmbleBee.", "A little nudge to get out the door together.")):
        text = text.replace(f'content="{esc(old)}"', f'content="{esc(new)}"')
    (Path(out) / "404.html").write_text(text.replace("<title>", '<meta name="robots" content="noindex">\n<title>', 1), encoding="utf-8")

    newest = max(lastmod.values(), default=None)
    for u in ("/", "/missions/", "/missions/all/"):
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
        text = f.read_text(encoding="utf-8")
        assert "<!--shared-head-->" in text, f"site/{name} lost its <!--shared-head--> line"
        text = text.replace("<!--shared-head-->", SHARED_HEAD).replace("<!--site-nav-->", nav_html(current)).replace("<!--site-footer-->", footer_html()).replace("<!--ideas-->", ideas_html(collections))
        text = text.replace("<!--vibes-->", vibes_html(collections)).replace("<!--live-count-->", str(stats["live"]))
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
