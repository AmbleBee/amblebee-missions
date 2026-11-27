"""Field notes posts as real pages, for tools/build_pages.py.

AmbleBee Intake sends every published post to data/fieldnotes/ (its app/fnsite.py):
    posts.json        {"posts": [...], "default_backdrop": "<pub>"}: each post as the intake's public API gives it
    backdrops/*.jpg   the header backdrops those posts use, and the library's first (the fallback header)
    photos/*.webp     the posts' photos, made small for the page (the intake's app/sitephotos.py)

From those, build_pages.py writes:
    fieldnotes/<post>/index.html   the post, readable without any script, so search engines list it. site/js/fieldnotes.js
                                   then asks the intake for the live copy (newer edits, the thumbs up count) and draws
                                   that instead, or leaves this one up when the intake can't be reached.
    fieldnotes/index.html          the list page gets every post as a card too (the same fallback: the live list replaces it)
    fn-backdrops/<pub>.jpg         the backdrops, so headers load from this site, plus default.jpg
    fn-photos/<pub>.webp           the photos, so they load from this site too
Each page also lists which photos and backdrops this site has (#fn-local), so site/js/fieldnotes.js only asks this site
for those, and asks the intake for the rest (a post published since this build). A photo that can't load from either
says so where it would be.

The markup here matches site/js/fieldnotes.js (draw, header, block, gallery, missionCard, card): change both together."""
import datetime
import html
import json
import re
import shutil
from pathlib import Path
from zoneinfo import ZoneInfo

esc = lambda v: html.escape(str(v), quote=True)  # noqa: E731
INTAKE = "https://amblebee-intake.tail58116.ts.net"   # AmbleUtil.API in site/js/util.js
TZ = ZoneInfo("America/Los_Angeles")                 # dates show as the post's day in AmbleBee's home time zone
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
PUB = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
BACKDROP = re.compile(r"^/fieldnotes/backdrop/([A-Za-z0-9_-]{1,40})\.jpg$")
PHOTO = re.compile(r"^/fieldnotes/photo/([A-Za-z0-9_-]{1,40})\.[a-z]+$")
LOCAL = {"photos": set(), "backdrops": set()}   # what copy_files() put on the site
TINTS = ["sage", "honey", "walnut", "sky"]
G = ' class="g"'   # the first tag on a card stands out
MTN = ('<svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100 L0 60 L40 30 L70 55 '
       'L110 15 L150 50 L175 35 L200 55 L200 100Z"/></svg>')
LABEL = {"mode": {"date": "Date", "adventure": "Adventure", "both": "Date or adventure"},
         "duration": {"short": "1-3 hours", "half-day": "Half day", "all-day": "All day"},
         "cost": {"free": "Free", "$": "Under $20", "$$": "$20-60", "$$$": "Over $60"}}


def load(root):
    """The posts the intake sent, newest Field Note first, or [] (no file yet, or nothing published)."""
    f = Path(root) / "data" / "fieldnotes" / "posts.json"
    if not f.exists():
        return [], None
    data = json.loads(f.read_text(encoding="utf-8"))
    posts = [p for p in data.get("posts") or [] if SLUG.match(str(p.get("slug") or ""))]
    posts.sort(key=lambda p: -(p.get("number") or 0))
    default = data.get("default_backdrop")
    return posts, default if default and PUB.match(default) else None


def copy_files(root, out, default):
    """data/fieldnotes/backdrops/*.jpg -> <out>/fn-backdrops/ (the fallback also as default.jpg), and
    data/fieldnotes/photos/*.webp -> <out>/fn-photos/."""
    LOCAL["photos"], LOCAL["backdrops"] = set(), set()
    for kind, ext, folder in (("backdrops", "jpg", "fn-backdrops"), ("photos", "webp", "fn-photos")):
        src = Path(root) / "data" / "fieldnotes" / kind
        if not src.is_dir():
            continue
        dest = Path(out) / folder
        dest.mkdir(parents=True, exist_ok=True)
        for f in src.glob(f"*.{ext}"):
            if PUB.match(f.stem):
                shutil.copyfile(f, dest / f.name)
                LOCAL[kind].add(f.stem)
    if default and default in LOCAL["backdrops"]:
        shutil.copyfile(Path(out) / "fn-backdrops" / f"{default}.jpg", Path(out) / "fn-backdrops" / "default.jpg")
        LOCAL["backdrops"].add("default")


def local_marker():
    """Tells site/js/fieldnotes.js which photos and backdrops this site has."""
    return (f'<div id="fn-local" hidden data-photos="{esc(" ".join(sorted(LOCAL["photos"])))}" '
            f'data-backdrops="{esc(" ".join(sorted(LOCAL["backdrops"])))}"></div>')


def photo_src(p):
    """This site's small copy when it has one, else the intake's."""
    m = PHOTO.match(str(p.get("url") or ""))
    return f"/fn-photos/{m.group(1)}.webp" if m and m.group(1) in LOCAL["photos"] else INTAKE + p["url"]


def _day(iso, long=True):
    try:
        t = datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(TZ)
    except (TypeError, ValueError):
        return ""
    return t.strftime("%B %-d, %Y") if long else t.strftime("%b %-d, %Y")


def ymd(iso):
    try:
        return datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(TZ).date().isoformat()
    except (TypeError, ValueError):
        return None


# ---------- words: the same little formatting as inline() in site/js/fieldnotes.js ----------
INLINE = re.compile(r"`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)")


def _link(text, href):
    if re.match(r"^/(?!/)", href):
        return f'<a href="{esc(href)}">{esc(text)}</a>'
    if re.match(r"^https?://", href, re.I):
        if re.match(r"^https?://(www\.)?amblebee\.com(/|$)", href, re.I):
            return f'<a href="{esc(href)}">{esc(text)}</a>'
        return f'<a href="{esc(href)}" target="_blank" rel="noopener">{esc(text)}</a>'
    return esc(text)


def inline(text):
    out, last = [], 0
    for m in INLINE.finditer(text):
        out.append(esc(text[last:m.start()]))
        if m.group(1):
            out.append(f"<code>{esc(m.group(1))}</code>")
        elif m.group(2):
            out.append(f"<strong>{esc(m.group(2))}</strong>")
        elif m.group(3):
            out.append(f"<s>{esc(m.group(3))}</s>")
        elif m.group(4):
            out.append(f"<em>{esc(m.group(4))}</em>")
        else:
            out.append(_link(m.group(5), m.group(6)))
        last = m.end()
    out.append(esc(text[last:]))
    return "".join(out)


def lines(text):
    return "<br>".join(inline(line) for line in str(text or "").split("\n"))


def plain(text):
    """Formatting marks taken out, for descriptions."""
    return INLINE.sub(lambda m: m.group(1) or m.group(2) or m.group(3) or m.group(4) or m.group(5) or "", str(text or ""))


# ---------- pictures ----------
def stand(seed, label=""):
    n = sum(ord(c) for c in seed) % len(TINTS)
    return f'<div class="fn-ph {TINTS[n]}">{MTN}' + (f"<span>{esc(label)}</span>" if label else "") + "</div>"


def photo(p, alt="", eager=False):
    size = "".join(f' {k}="{int(p[k])}"' for k in ("width", "height") if p.get(k))
    return (f'<img src="{esc(photo_src(p))}" alt="{esc(alt)}"{size} loading="{"eager" if eager else "lazy"}" '
            f'decoding="async">')


def size_class(title):
    n = len(title or "")
    return "s1" if n <= 22 else "s2" if n <= 40 else "s3" if n <= 60 else "s4" if n <= 80 else "s5"


def shade_fill(a):
    try:
        a = float(a)
    except (TypeError, ValueError):
        a = 0.5
    return (f"linear-gradient(180deg, rgba(30,20,12,{a * 0.7:.2f}), rgba(30,20,12,{a:g}) 45%, "
            f"rgba(30,20,12,{min(0.9, a + 0.15):.2f}))")


def backdrop_src(h):
    """Headers load from this site (fn-backdrops/); site/js/fieldnotes.js falls back to the intake, then default.jpg."""
    m = BACKDROP.match(str((h or {}).get("backdrop") or ""))
    if m and m.group(1) in LOCAL["backdrops"]:
        return f"/fn-backdrops/{m.group(1)}.jpg"
    if m:
        return INTAKE + h["backdrop"]
    return "/fn-backdrops/default.jpg"


def has_header(p):
    return bool((p.get("header") or {}).get("backdrop"))


def header(p, page=False, compact=False, eager=False):
    h, n = p.get("header") or {}, p.get("number")
    x = h.get("phone_x")
    x = 0.5 if x is None else x
    tag = "h1" if page else "div"
    topic = (p.get("topics") or [None])[0]
    chip = f'<span class="ch">{esc(topic)}</span>' if topic else ""
    no = ("Field Note No. " + (f"0{n}" if n < 10 else str(n))) if n else "Field Note"
    return (f'<div class="fnh {size_class(p.get("title"))}{" compact" if compact else ""}{" page" if page else ""}">'
            f'<img class="bg" src="{esc(backdrop_src(h))}" alt="" loading="{"eager" if eager else "lazy"}" decoding="async" '
            f'style="object-position:{float(x) * 100:g}% 50%">'
            f'<div class="sh" style="background:{shade_fill(h.get("shade"))}"></div>'
            f'<div class="tx"><div class="no">{no}</div>'
            f'<{tag} class="tt">{esc(p.get("title"))}</{tag}>'
            f'<div class="mt">{chip}<span>amblebee.com/fieldnotes</span></div></div>'
            f'<img class="bee" src="/favicon.svg" alt=""></div>')


# ---------- the post ----------
def gallery(photos):
    if not photos:
        return ""
    figs = []
    for i, p in enumerate(photos):
        cap = p.get("caption") or ""
        label = "Open the photo full size" + (f": {cap}" if cap else "")
        first = ' class="first"' if i == 0 else ""
        figs.append(f'<figure{first}><a href="{esc(photo_src(p))}" target="_blank" rel="noopener" '
                    f'aria-label="{esc(label)}">{photo(p, cap)}</a>' + (f"<figcaption>{esc(cap)}</figcaption>" if cap else "") + "</figure>")
    return f'<div class="fn-gallery n{min(len(photos), 3)}">' + "".join(figs) + "</div>"


def mission_card(m, packs):
    if not m:
        return ""   # a mission that's no longer on the site
    tags = [t for t in (LABEL["mode"].get(m.get("mode")), LABEL["duration"].get(m.get("duration")), LABEL["cost"].get(m.get("cost"))) if t]
    tag_html = "".join(f'<span{G if i == 0 else ""}>{esc(t)}</span>' for i, t in enumerate(tags))
    return (f'<a class="fn-mission" href="/missions/{esc(m["id"])}/"><small>{esc(packs.get(m.get("pack")) or "AmbleBee")} · '
            f'Mission {esc(m.get("number"))}</small><b>{esc(m.get("name"))}</b>'
            + (f'<span class="fn-mshort">{esc(m["short"])}</span>' if m.get("short") else "")
            + f'<span class="fn-tags">{tag_html}</span><span class="fn-mgo">Open the mission →</span></a>')


def block(b, by_id, packs):
    t = b.get("type")
    if t == "p":
        return f"<p>{lines(b.get('text'))}</p>"
    if t in ("h2", "h3"):
        return f"<{t}>{esc(b.get('text'))}</{t}>"
    if t == "quote":
        return f'<blockquote class="fn-quote"><p>{lines(b.get("text"))}</p></blockquote>'
    if t == "list":
        return "<ul>" + "".join(f"<li>{inline(i)}</li>" for i in b.get("items") or []) + "</ul>"
    if t == "photos":
        return gallery(b.get("photos") or [])
    if t == "mission":
        return mission_card(by_id.get(b.get("mission")), packs)
    if t == "code":
        return f'<pre class="fn-code"><code>{esc(b.get("text"))}</code></pre>'
    return ""


def meta_bits(p):
    bits = [f"Posted {_day(p.get('posted_at'))}"]
    if p.get("edited_at") and _day(p["edited_at"]) != _day(p.get("posted_at")):
        bits.append(f"Last edited {_day(p['edited_at'])}")
    bits.append(f"{p.get('minutes') or 1} min read")
    if p.get("series"):
        bits.append(series_part(p["series"]))
    return " · ".join(bits)


# ---------- a series: posts that belong together (AmbleBee Intake, app/fieldnotes.py _series_public) ----------
def series_part(s):
    """"Part 2 of Developing AmbleBee", or just the series' name while it has one part."""
    return f"Part {s['part']} of {s['name']}" if s.get("of", 1) > 1 else f"The {s['name']} series"


def series_box(s):
    """At the end of a post: every part of its series in order, linked, with this one marked."""
    if not s or s.get("of", 1) < 2:
        return ""
    items = "".join(f'<li aria-current="page"><b>{esc(x["title"])}</b> <span>You\'re here</span></li>' if x.get("current")
                    else f'<li><a href="/fieldnotes/{esc(x["slug"])}/">{esc(x["title"])}</a></li>' for x in s.get("posts") or [])
    return (f'<nav class="fn-series" aria-label="The {esc(s["name"])} series"><p class="fn-series-k">A series in {s["of"]} parts</p>'
            f'<h2>{esc(s["name"])}</h2><ol>{items}</ol></nav>')


def description(p, limit):
    text = (p.get("summary") or "").strip()
    if not text:
        text = next((plain(b.get("text")) for b in p.get("blocks") or [] if b.get("type") == "p" and b.get("text")), "")
    text = " ".join(text.split())
    if len(text) > limit:
        text = text[:limit - 1].rsplit(" ", 1)[0].rstrip(",.;:") + "…"
    return text or f"Field Note No. {p.get('number')} on the AmbleBee blog."


def post_main(p, missions, packs):
    """The page's <main> content: the same article site/js/fieldnotes.js draws, plus the post itself as data for it."""
    by_id = {}
    for m in missions:
        by_id[m["id"]] = m
        if m.get("full_id"):
            by_id[m["full_id"]] = m
    topics = p.get("topics") or []
    tags = ('<div class="fn-tags">' + "".join(f'<a href="/fieldnotes/?topic={esc(_q(t))}">{esc(t)}</a>' for t in topics) + "</div>") if topics else ""
    top = header(p, page=True, eager=True) if has_header(p) else f"<h1>{esc(p.get('title'))}</h1>"
    meta = meta_bits(p)
    dek = (f'<div class="fn-dek{" lift" if has_header(p) else ""}"><p class="fn-meta">{esc(meta)}</p>'
           f'<p class="fn-dek-sum">{esc(p["summary"])}</p></div>') if p.get("summary") else f'<p class="fn-meta">{esc(meta)}</p>'
    blocks = p.get("blocks") or []
    cover = ""
    if not has_header(p) and p.get("cover"):
        first = next((b for b in blocks if b.get("type") == "photos"), None)
        same = first is not None and blocks.index(first) == 0 and first.get("photos") and first["photos"][0].get("url") == p["cover"].get("url")
        if not same:
            cover = f'<figure class="fn-cover">{photo(p["cover"], "", eager=True)}</figure>'
    body = "".join(block(b, by_id, packs) for b in blocks)
    data = json.dumps(p, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    return (f'<div class="page page-wide pg fieldnotes">\n<article class="fn-post" id="fn-static" data-slug="{esc(p["slug"])}">'
            f'<section class="pg-hero fn-hero"><p class="fn-crumb"><a href="/fieldnotes/">← Field notes</a></p>{tags}{top}{dek}</section>'
            f'<section class="pg-band fn-band"><div class="fn-article">{cover}<div class="fn-prose">{body}</div>'
            f'{series_box(p.get("series"))}<p class="fn-end"><a class="btn" href="/fieldnotes/">More field notes</a><a class="btn primary" href="/">Give me a mission</a></p>'
            f'</div></section></article>\n<script type="application/json" id="fn-data">{data}</script>\n{local_marker()}\n</div>\n'
            '<script src="/js/fieldnotes.js" defer></script>')


def _q(t):
    from urllib.parse import quote
    return quote(t, safe="")


def post_jsonld(p, base, url, image, desc):
    ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": p.get("title"), "description": desc,
          "url": url, "mainEntityOfPage": url, "image": image,
          "datePublished": p.get("posted_at"), "dateModified": p.get("edited_at") or p.get("posted_at"),
          "author": {"@type": "Organization", "name": "AmbleBee", "url": base + "/"},
          "publisher": {"@type": "Organization", "name": "AmbleBee", "url": base + "/",
                        "logo": {"@type": "ImageObject", "url": base + "/favicon-192.png"}}}
    if p.get("topics"):
        ld["keywords"] = ", ".join(p["topics"])
    return {k: v for k, v in ld.items() if v}


# ---------- the list page: every post as a card, until the live list arrives ----------
def card(p):
    if has_header(p):
        pic = header(p, compact=True)
    elif p.get("cover"):
        pic = photo(p["cover"])
    else:
        pic = stand(p["slug"])
    topics = p.get("topics") or []
    tags = ('<div class="fn-tags">' + "".join(f'<span{G if i == 0 else ""}>{esc(t)}</span>' for i, t in enumerate(topics))
            + "</div>") if topics else ""
    return (f'<a class="fn-card" href="/fieldnotes/{esc(p["slug"])}/"><div class="fn-pic">{pic}</div><div class="fn-body">'
            f'<span class="fn-meta">{esc(_day(p.get("posted_at"), long=False))} · {p.get("minutes") or 1} min read</span>'
            + (f'<span class="fn-ser">{esc(series_part(p["series"]))}</span>' if p.get("series") else "") +
            f'<h3>{esc(p.get("title"))}</h3>' + (f"<p>{esc(p['summary'])}</p>" if p.get("summary") else "") + f"{tags}</div></a>")


def list_fill(body, posts):
    """pages/fieldnotes.html with the cards in #fn-list and the count beside it."""
    body = body.replace('<div id="fn-page">', '<div id="fn-page">\n' + local_marker(), 1)
    if not posts:
        return body
    cards = "".join(card(p) for p in posts)
    body, n = re.subn(r'(<div class="fn-grid" id="fn-list"[^>]*>)(</div>)', lambda m: m.group(1) + cards + m.group(2), body, count=1)
    assert n == 1, 'pages/fieldnotes.html lost its <div class="fn-grid" id="fn-list"> line'
    count = f"{len(posts)} post{'s' if len(posts) != 1 else ''}"
    return re.sub(r'(<span class="fn-count" id="fn-count"[^>]*>)(</span>)', lambda m: m.group(1) + count + m.group(2), body, count=1)
