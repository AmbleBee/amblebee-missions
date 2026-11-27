/* Field notes, the AmbleBee blog. The posts and their photos live on AmbleBee Intake (app/fieldnotes.py there), which
   also sends each published post's words here, so the build makes it a real page (tools/build_fieldnotes.py):
     /fieldnotes/          pages/fieldnotes.html: the list, with search and topic chips, 12 posts at a time (See more posts
                           adds 12 more; the pinned post sits above them). Built with every post as a card,
                           which the live list replaces (and which stays if the intake can't be reached).
     /fieldnotes/<post>/   built with the post on it (#fn-static, and the post as data in #fn-data). This script draws it
                           again from the intake's live copy: newer edits and the thumbs up count. If the intake doesn't
                           answer, the built post stays; if it says the post is gone, the page says so.
                           A post published in the last few minutes has no page yet: GitHub Pages answers with 404.html,
                           and this script turns that page into the post. ?preview=<token> (the intake's Preview) shows a draft.
   Photos and header backdrops load from this site (fn-photos/, fn-backdrops/: small copies the intake sends with the
   posts), when the build's #fn-local says it has them; otherwise, or if they fail, from the intake. A header with
   neither falls back to the default backdrop. A photo in a post that can't load says so where it would be; a cover
   that can't load becomes the soft mountain picture. Draft previews always use the intake. */
(function () {
  "use strict";
  var U = window.AmbleUtil, el = U.el, API = U.API;
  var POST_PATH = /^\/fieldnotes\/([a-z0-9][a-z0-9-]{0,79})\/?$/;
  var LABEL = {   // the same words as the labels at the top of site/js/core.js
    mode: { date: "Date", adventure: "Adventure", both: "Date or adventure" },
    duration: { short: "1-3 hours", "half-day": "Half day", "all-day": "All day" },
    cost: { free: "Free", "$": "Under $20", "$$": "$20-60", "$$$": "Over $60" }
  };
  var MTN = '<svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 100 L0 60 L40 30 L70 55 L110 15 L150 50 L175 35 L200 55 L200 100Z"/></svg>';
  var PIN = '<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8"/></svg>';
  var TINTS = ["sage", "honey", "walnut", "sky"];
  var THUMB = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z"/><path d="M7 10.5l3.6-6.6a1.8 1.8 0 0 1 3.3 1.3L13 9.5h5.4a2 2 0 0 1 2 2.4l-1.4 6.4a2 2 0 0 1-2 1.7H7"/></svg>';
  var SORT = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>';
  var THUMBS_KEY = "amble.fieldnotes.thumbs";
  // the photos and backdrops this site was built with (tools/build_fieldnotes.py): only those are asked for here
  var LOCAL = (function () {
    var e = document.getElementById("fn-local");
    function set(a) { var o = {}; (a || "").split(" ").forEach(function (x) { if (x) o[x] = true; }); return o; }
    return { photos: set(e && e.getAttribute("data-photos")), backdrops: set(e && e.getAttribute("data-backdrops")) };
  })();
  var PHOTO_URL = /^\/fieldnotes\/photo\/([A-Za-z0-9_-]+)\.[a-z]+$/;   // {post: the token its thumbs up got}, so this browser can take it back

  function get(path) {
    return fetch(API + path, { cache: "no-cache" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { b.status = r.status; return b; });
    });
  }
  function day(iso, long) {
    var t = new Date(iso);
    if (isNaN(t)) return "";
    return t.toLocaleDateString("en-US", long ? { month: "long", day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  }
  function svg(markup) { var s = document.createElement("span"); s.innerHTML = markup; return s.firstChild; }   // our own fixed icons only
  function topicHref(t) { return "/fieldnotes/?topic=" + encodeURIComponent(t); }

  // a post with no photos still gets a picture: a soft mountain on one of the brand colors
  function stand(seed, label) {
    var n = 0; for (var i = 0; i < seed.length; i++) n = (n + seed.charCodeAt(i)) % TINTS.length;
    var box = el("div", { class: "fn-ph " + TINTS[n] }, svg(MTN));
    if (label) box.append(el("span", { text: label }));
    return box;
  }
  function photo(p, preview, attrs, onfail) {
    var api = API + p.url + (preview ? "?preview=" + encodeURIComponent(preview) : "");
    var m = !preview && PHOTO_URL.exec(p.url || ""), tries = m && LOCAL.photos[m[1]] ? ["/fn-photos/" + m[1] + ".webp", api] : [api];
    var img = el("img", Object.assign({ src: tries.shift(), alt: "", width: p.width || null, height: p.height || null, loading: "lazy", decoding: "async" }, attrs || {}));
    img.addEventListener("error", function next() {
      if (tries.length) { img.src = tries.shift(); return; }
      img.removeEventListener("error", next);
      if (onfail) onfail(img);
    });
    return img;
  }
  // a cover or card picture that can't load: the soft mountain instead, without a fuss
  function orStand(seed) {
    return function (img) { var box = img.closest(".fn-pic, .fn-cover") || img.parentNode; box.replaceChildren(stand(seed)); };
  }
  // a photo in the post that can't load: a box the same shape, saying so
  function missing_photo(p) {
    return function (img) {
      var box = el("div", { class: "fn-photo-miss", role: "img", "aria-label": "This photo didn't load" },
        el("span", { text: "Problem loading photo, check back later" }));
      if (p.width && p.height) box.style.aspectRatio = p.width + " / " + p.height;
      var link = img.closest("a");
      (link || img).replaceWith(box);
    };
  }

  // ---- the header: the post's backdrop, darkened, with its Field Note number, title and first topic on top ----
  // (the intake's editor draws the same thing: app/admin.py headerEl). 1200:630; the post page goes square on phones.
  function sizeClass(t) { var n = (t || "").length; return n <= 22 ? "s1" : n <= 40 ? "s2" : n <= 60 ? "s3" : n <= 80 ? "s4" : "s5"; }
  function shadeFill(a) {
    a = Number(a); if (isNaN(a)) a = 0.5;
    return "linear-gradient(180deg, rgba(30,20,12," + (a * 0.7).toFixed(2) + "), rgba(30,20,12," + a + ") 45%, rgba(30,20,12," + Math.min(0.9, a + 0.15).toFixed(2) + "))";
  }
  function header(p, o) {
    o = o || {};
    var h = p.header || {}, n = p.number;
    // this site's copy of the backdrop first (tools/build_fieldnotes.py), then the intake's, then the default backdrop
    var pub = /^\/fieldnotes\/backdrop\/([A-Za-z0-9_-]+)\.jpg$/.exec(h.backdrop || ""), tries = [];
    if (pub && LOCAL.backdrops[pub[1]]) tries.push("/fn-backdrops/" + pub[1] + ".jpg");
    tries.push(API + h.backdrop);
    if (LOCAL.backdrops["default"]) tries.push("/fn-backdrops/default.jpg");
    var bg = el("img", { class: "bg", src: tries.shift(), alt: "", loading: o.eager ? "eager" : "lazy", decoding: "async" });
    bg.addEventListener("error", function next() {
      if (tries.length) bg.src = tries.shift();
      else { bg.removeEventListener("error", next); bg.hidden = true; }   // no picture at all: the header's own color shows
    });
    bg.style.objectPosition = ((h.phone_x == null ? 0.5 : h.phone_x) * 100) + "% 50%";
    var shade = el("div", { class: "sh" }); shade.style.background = shadeFill(h.shade);
    return el("div", { class: "fnh " + sizeClass(p.title) + (o.compact ? " compact" : "") + (o.page ? " page" : "") },
      bg, shade,
      el("div", { class: "tx" },
        el("div", { class: "no", text: n ? "Field Note No. " + (n < 10 ? "0" + n : n) : "Field Note" }),
        el(o.page ? "h1" : "div", { class: "tt", text: p.title }),
        el("div", { class: "mt" }, p.topics[0] ? el("span", { class: "ch", text: p.topics[0] }) : null, el("span", { text: "amblebee.com/fieldnotes" }))),
      el("img", { class: "bee", src: "/favicon.svg", alt: "" }));
  }
  function hasHeader(p) { return !!(p.header && p.header.backdrop); }
  // a series: posts that belong together (AmbleBee Intake, app/fieldnotes.py _series_public; tools/build_fieldnotes.py too)
  function seriesPart(s) { return s.of > 1 ? "Part " + s.part + " of " + s.name : "The " + s.name + " series"; }
  function seriesBox(s) {
    if (!s || s.of < 2) return null;
    return el("nav", { class: "fn-series", "aria-label": "The " + s.name + " series" },
      el("p", { class: "fn-series-k", text: "A series in " + s.of + " parts" }), el("h2", { text: s.name }),
      el("ol", {}, (s.posts || []).map(function (x) {
        return x.current ? el("li", { "aria-current": "page" }, el("b", { text: x.title }), " ", el("span", { text: "You're here" }))
          : el("li", {}, el("a", { href: "/fieldnotes/" + x.slug + "/", text: x.title }));
      })));
  }

  // **bold**, *italic*, ~~strikethrough~~, `code` and [a link](https://…), the only formatting the editor has (paragraphs, quotes and lists; headings stay plain). Built as nodes, never as HTML.
  function inline(text) {
    // `code` comes first, so nothing inside it is read as formatting
    var out = [], re = /`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) out.push(el("code", { text: m[1] }));
      else if (m[2]) out.push(el("strong", { text: m[2] }));
      else if (m[3]) out.push(el("s", { text: m[3] }));
      else if (m[4]) out.push(el("em", { text: m[4] }));
      else out.push(link(m[5], m[6]));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  // a paragraph or quote: each line through inline(), with a line break between them
  function lines(text) {
    var out = [];
    String(text || "").split("\n").forEach(function (line, i) { if (i) out.push(el("br")); out = out.concat(inline(line)); });
    return out;
  }
  function link(text, href) {
    if (/^\/(?!\/)/.test(href)) return el("a", { href: href, text: text });
    if (/^https?:\/\//i.test(href)) {
      var here = /^https?:\/\/(www\.)?amblebee\.com(\/|$)/i.test(href);
      return el("a", { href: href, text: text, target: here ? null : "_blank", rel: here ? null : "noopener" });
    }
    return text;   // anything else (javascript:, mailto: typos) stays plain words
  }

  // ======================================== the list: /fieldnotes/ ========================================
  function listPage(root) {
    var box = root.querySelector("#fn-list"), feat = root.querySelector("#fn-feature"), chips = root.querySelector("#fn-topics");
    var search = root.querySelector("#fn-search"), count = root.querySelector("#fn-count"), moreBtn = root.querySelector("#fn-more");
    var heading = root.querySelector("#fn-latest"), orderBtn = root.querySelector("#fn-order");
    var params = new URLSearchParams(location.search);
    // the cards the build put here (every post, newest first): kept if the live list can't load
    var built = Array.prototype.slice.call(box.children), builtCount = count.textContent;
    built.forEach(function (a) {
      a.querySelectorAll("img").forEach(function (img) {
        var seed = (/\/fieldnotes\/([^/]+)\//.exec(a.getAttribute("href")) || [])[1] || "x";
        if (img.classList.contains("bg")) return;
        if (img.complete && !img.naturalWidth) orStand(seed)(img);
        else img.addEventListener("error", function () { orStand(seed)(img); }, { once: true });
      });
      a.querySelectorAll("img.bg").forEach(builtBackdrop);
    });
    var state = { q: params.get("q") || "", topic: params.get("topic") || "", order: params.get("order") === "old" ? "old" : "new", page: 1 },
      ask = 0, timer = null, offline = false, builtShown = 0;
    var PAGE = 12;   // the intake sends 12 posts at a time (PAGE in its app/fieldnotes.py), plus the pinned one above the grid
    // how many are on screen, when there are more to see
    function counted(shown, total) {
      count.textContent = shown < total ? "Showing " + shown + " of " + total : total + (total === 1 ? " post" : " posts");
    }
    // the intake can't be reached: the built cards, 12 at a time like the live list
    function drawBuilt(n) {
      builtShown = Math.min(n, built.length);
      box.replaceChildren.apply(box, built.slice(0, builtShown));
      if (built.length > PAGE) counted(builtShown, built.length); else count.textContent = builtCount;
      moreBtn.hidden = builtShown >= built.length;
      moreBtn.disabled = false;
    }
    search.value = state.q;
    // newest first (by Field Note number), or flip it to start from No. 01
    if (!orderBtn) {
      orderBtn = el("button", { type: "button", class: "fn-order", id: "fn-order" });
      count.parentNode.append(orderBtn);
    }
    function drawOrder() {
      orderBtn.replaceChildren(svg(SORT), state.order === "old" ? "Oldest first" : "Newest first");
      orderBtn.setAttribute("aria-label", state.order === "old" ? "Showing oldest first. Show newest first" : "Showing newest first. Show oldest first");
    }
    orderBtn.addEventListener("click", function () { state.order = state.order === "old" ? "new" : "old"; drawOrder(); load(false); });
    drawOrder();

    function card(p) {
      var pic = hasHeader(p) ? header(p, { compact: true }) : p.cover ? photo(p.cover, "", {}, orStand(p.slug)) : stand(p.slug);
      return el("a", { class: "fn-card", href: "/fieldnotes/" + p.slug + "/" },
        el("div", { class: "fn-pic" }, pic),
        el("div", { class: "fn-body" },
          el("span", { class: "fn-meta", text: day(p.posted_at) + " · " + p.minutes + " min read" }),
          p.series ? el("span", { class: "fn-ser", text: seriesPart(p.series) }) : null,
          el("h3", { text: p.title }),
          p.summary ? el("p", { text: p.summary }) : null,
          p.topics.length ? el("div", { class: "fn-tags" }, p.topics.map(function (t, i) { return el("span", { class: i ? null : "g", text: t }); })) : null));
    }
    function feature(p) {
      var pic = hasHeader(p) ? header(p, { eager: true }) : p.cover ? photo(p.cover, "", { loading: "eager" }, orStand(p.slug)) : stand(p.slug);
      return el("a", { class: "fn-feat", href: "/fieldnotes/" + p.slug + "/" },
        el("div", { class: "fn-pic" }, pic),
        el("div", { class: "fn-body" },
          el("span", { class: "fn-pin" }, svg(PIN), "Pinned"),
          el("span", { class: "fn-meta", text: day(p.posted_at, true) + " · " + p.minutes + " min read" }),
          p.series ? el("span", { class: "fn-ser", text: seriesPart(p.series) }) : null,
          el("h2", { text: p.title }),
          p.summary ? el("p", { text: p.summary }) : null,
          p.topics.length ? el("div", { class: "fn-tags" }, p.topics.map(function (t, i) { return el("span", { class: i ? null : "g", text: t }); })) : null,
          el("span", { class: "btn primary fn-read", text: "Read the post →" })));
    }
    function drawChips(topics) {
      var all = [""].concat(topics);
      if (state.topic && all.indexOf(state.topic) < 0) all.push(state.topic);
      chips.replaceChildren.apply(chips, all.map(function (t) {
        return el("button", { type: "button", class: "fn-chip", "aria-pressed": String(t === state.topic), text: t || "All",
          onclick: function () { state.topic = t; load(false); } });
      }));
      chips.hidden = topics.length === 0;
    }
    function remember() {
      var p = new URLSearchParams();
      if (state.q) p.set("q", state.q);
      if (state.topic) p.set("topic", state.topic);
      if (state.order === "old") p.set("order", "old");
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
    }
    function load(more) {
      state.page = more ? state.page + 1 : 1;
      remember();
      var mine = ++ask;
      if (!more) box.setAttribute("aria-busy", "true");
      moreBtn.disabled = true;
      var p = new URLSearchParams({ page: state.page });
      if (state.q) p.set("q", state.q);
      if (state.topic) p.set("topic", state.topic);
      if (state.order === "old") p.set("order", "old");
      get("/fieldnotes?" + p).then(function (b) {
        if (mine !== ask) return;
        box.removeAttribute("aria-busy");
        if (!b.ok) throw new Error("bad");
        offline = false;
        drawChips(b.topics || []);
        var posts = b.posts || [], filtered = state.q || state.topic;
        if (!more) {
          var top = !filtered && state.order !== "old" && posts[0] && posts[0].pinned ? posts.shift() : null;
          feat.replaceChildren(top ? feature(top) : "");
          feat.hidden = !top;
          box.replaceChildren();
        }
        posts.forEach(function (p) { box.append(card(p)); });
        heading.textContent = filtered ? "Matching posts" : state.order === "old" ? "From the first post" : "Latest posts";
        counted(box.querySelectorAll(".fn-card").length + (feat.hidden ? 0 : 1), b.total);
        if (!b.total) box.replaceChildren(el("p", { class: "fn-empty" }, filtered
          ? ["Nothing matches that yet. ", el("button", { type: "button", class: "linkish", text: "Show every post",
              onclick: function () { state.q = ""; state.topic = ""; search.value = ""; load(false); } })]
          : "The first field notes are on their way. Check back soon."));
        moreBtn.hidden = !b.more;
        moreBtn.disabled = false;
      }).catch(function () {
        if (mine !== ask) return;
        box.removeAttribute("aria-busy");
        moreBtn.hidden = true;
        count.textContent = "";
        if (more) return;
        if (built.length && !state.q && !state.topic) {   // the posts this page was built with, rather than nothing
          offline = true;
          feat.hidden = true;
          drawBuilt(PAGE);
          return;
        }
        box.replaceChildren(el("p", { class: "fn-empty" }, "Field notes couldn't load right now. Try again in a little while."));
      });
    }
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = search.value.trim(); load(false); }, 300);
    });
    root.querySelector("#fn-search-form").addEventListener("submit", function (e) {
      e.preventDefault(); clearTimeout(timer); state.q = search.value.trim(); load(false);
    });
    moreBtn.addEventListener("click", function () { if (offline) drawBuilt(builtShown + PAGE); else load(true); });
    load(false);
  }

  // ===================================== one post: /fieldnotes/<post>/ =====================================
  // a header the build drew (the list's cards): this site's backdrop, else the intake's, else the default
  function builtBackdrop(img) {
    var m = /\/fn-backdrops\/([A-Za-z0-9_-]+)\.jpg/.exec(img.getAttribute("src") || ""), tries = [];
    if (m && m[1] !== "default") tries.push(API + "/fieldnotes/backdrop/" + m[1] + ".jpg");
    if (LOCAL.backdrops["default"] && !(m && m[1] === "default")) tries.push("/fn-backdrops/default.jpg");
    function next() {
      if (tries.length) img.src = tries.shift();
      else { img.removeEventListener("error", next); img.hidden = true; }
    }
    img.addEventListener("error", next);
    if (img.complete && !img.naturalWidth) next();
  }

  // the post's words, for telling whether the intake's copy differs from the one this page was built with
  function canon(v) {
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(function (k) {
      return ["thumbs", "pinned", "draft"].indexOf(k) < 0;
    }).map(function (k) { return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }

  function postPage(slug) {
    var preview = new URLSearchParams(location.search).get("preview") || "";
    var built = document.getElementById("fn-static"), data = document.getElementById("fn-data"), root, post = null;
    if (built && data && !preview) {
      // a built page: the post is already here. Draw it again (the same thing, with the photo fallbacks and the thumbs
      // button), then swap in the intake's live copy if it's newer.
      root = built;
      try { post = JSON.parse(data.textContent); } catch (e) { post = null; }
    } else {
      var wrap = document.querySelector("main .page");
      var gone = document.getElementById("nf");
      root = el("article", { class: "fn-post", "aria-busy": "true" }, el("p", { class: "fn-loading", text: "Opening the post…" }));
      wrap.className = "page page-wide pg fieldnotes";
      if (gone) gone.hidden = true;
      if (built) built.remove();
      wrap.append(root);
      document.title = "Field notes · AmbleBee";
    }

    var catalog = null;
    function withCatalog(p) {
      if (!p.blocks.some(function (x) { return x.type === "mission"; })) return Promise.resolve({});
      catalog = catalog || fetch("/catalog.json", { cache: "force-cache" }).then(function (r) { return r.json(); }).catch(function () { return {}; });
      return catalog;
    }
    var shown = null, tracking = false;
    function show(p) {
      return withCatalog(p).then(function (c) {
        shown = p;
        draw(root, p, preview, c);
        if (!tracking && !p.draft && !preview) { tracking = true; track(root, p); }
      });
    }
    var first = post ? show(post) : Promise.resolve();
    get("/fieldnotes/" + slug + (preview ? "?preview=" + encodeURIComponent(preview) : "")).then(function (b) {
      return first.then(function () {
        if (!b.ok) {
          // the intake says it's gone (unpublished or deleted since this page was built); any other trouble, keep the built post
          if (b.status === 404 || !post) missing(root, b.status === 404);
          return;
        }
        if (shown && canon(shown) === canon(b.post)) { setThumbs(root, b.post.thumbs); return; }
        return show(b.post);
      });
    }).catch(function () { return first.then(function () { if (!post) missing(root, false); }); });
  }

  function missing(root, gone) {
    root.removeAttribute("aria-busy");
    root.replaceChildren(el("section", { class: "pg-hero" },
      el("p", { class: "eyebrow", text: "Field notes" }),
      el("h1", { text: gone ? "This post isn't here" : "This post couldn't load" }),
      el("p", { class: "hand", text: gone ? "It may have moved or been taken down." : "Try again in a little while." }),
      el("div", { class: "ticket-actions" }, el("a", { class: "btn primary", href: "/fieldnotes/", text: "See all field notes" }),
        el("a", { class: "btn", href: "/", text: "Give me a mission" }))));
  }

  function draw(root, post, preview, catalog) {
    document.title = post.title + " · Field notes · AmbleBee";
    var bits = ["Posted " + day(post.posted_at || new Date().toISOString(), true)];
    if (post.edited_at && day(post.edited_at, true) !== day(post.posted_at, true)) bits.push("Last edited " + day(post.edited_at, true));
    bits.push(post.minutes + " min read");
    if (post.series) bits.push(seriesPart(post.series));
    if (post.draft) bits[0] = "Not published yet";
    var hero = el("section", { class: "pg-hero fn-hero" },
      post.draft ? el("p", { class: "fn-draft", role: "note" }, el("b", { text: "Preview" }),
        " This is a draft. Only someone with this link can see it, and it isn't on the Field notes page yet.") : null,
      el("p", { class: "fn-crumb" }, el("a", { href: "/fieldnotes/", text: "← Field notes" })),
      post.topics.length ? el("div", { class: "fn-tags" }, post.topics.map(function (t) { return el("a", { href: topicHref(t), text: t }); })) : null,
      hasHeader(post) ? header(post, { page: true, eager: true }) : el("h1", { text: post.title }),
      // the summary and the dates in a paper card that tucks up under the header, instead of loose text below it
      post.summary
        ? el("div", { class: "fn-dek" + (hasHeader(post) ? " lift" : "") },
            el("p", { class: "fn-meta", text: bits.join(" · ") }),
            el("p", { class: "fn-dek-sum", text: post.summary }))
        : el("p", { class: "fn-meta", text: bits.join(" · ") }));
    var body = el("div", { class: "fn-prose" });
    var packs = {}, byId = {};
    (catalog.packs || []).forEach(function (p) { packs[p.id] = p.name; });
    (catalog.missions || []).forEach(function (m) { byId[m.id] = m; byId[m.full_id] = m; });
    post.blocks.forEach(function (b) { var n = block(b, preview, byId, packs); if (n) body.append(n); });
    var cover = !hasHeader(post) && post.cover ? el("figure", { class: "fn-cover" }, photo(post.cover, preview, { loading: "eager", alt: "" }, orStand(post.slug))) : null;
    var firstPhotos = post.blocks.find(function (b) { return b.type === "photos"; });
    if (cover && firstPhotos && firstPhotos.photos[0] && firstPhotos.photos[0].url === post.cover.url && post.blocks.indexOf(firstPhotos) === 0) cover = null;   // it'd show twice in a row
    root.removeAttribute("aria-busy");
    root.replaceChildren(hero, el("section", { class: "pg-band fn-band" }, el("div", { class: "fn-article" }, cover, body,
      post.draft ? null : thumbs(post), seriesBox(post.series),
      el("p", { class: "fn-end" }, el("a", { class: "btn", href: "/fieldnotes/", text: "More field notes" }),
        el("a", { class: "btn primary", href: "/", text: "Give me a mission" })))));
  }

  // once per page, however many times the post is drawn: reads, time on the page, and missions opened from it
  function track(root, post) {
    watchRead(post, function () { return root.querySelector(".fn-prose"); });
    // a mission opened from this post (a mission card, a mission link, or "Give me a mission"): one count for the post
    root.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.host !== location.host) return;
      if (a.pathname === "/" || /^\/missions\/[a-z0-9-]+\/$/.test(a.pathname)) {
        if (window.ambleTrack) window.ambleTrack("fieldnote_mission", { item: post.slug });
      }
    });
  }

  // ---- a read, and time on the page. A read: three quarters of the way down the post, after most of its reading time on
  // screen. Time: seconds the post is on screen, sent when the page is hidden or left (in pieces, if you come back).
  // Both go through site/js/count.js (no cookies, nothing kept in this browser); the server counts the same person once a
  // day per post for reads, and only adds up seconds for time. A fast reader gets a read at 60% of the "min read"
  // estimate, and never under 20 seconds.
  var READ_DEPTH = 0.75, READ_SHARE = 0.6, READ_MIN_SECONDS = 20;
  function watchRead(post, prose) {
    var need = Math.max(READ_MIN_SECONDS, (Number(post.minutes) || 1) * 60 * READ_SHARE), seen = 0, sent = 0, deep = false, done = false;
    function track(name, params) { if (window.ambleTrack) window.ambleTrack(name, params); }
    function depth() {
      var body = prose();
      if (!body) return;
      var r = body.getBoundingClientRect();
      if (r.height && (window.innerHeight - r.top) / r.height >= READ_DEPTH) deep = true;
    }
    function check() {
      if (done || !deep || seen < need) return;
      done = true;
      window.removeEventListener("scroll", onScroll);
      track("fieldnote_read", { item: post.slug });
    }
    function report() {
      var s = seen - sent;
      if (s < 1) return;
      track("fieldnote_time", { item: post.slug, seconds: s, first: sent === 0 });
      sent = seen;
    }
    function onScroll() { depth(); check(); }
    setInterval(function () {
      if (document.visibilityState !== "visible") return;
      seen += 1;
      depth();
      check();
    }, 1000);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") report(); });
    window.addEventListener("pagehide", report);
    depth();
  }

  // ---- thumbs up: one tap, and tap again to take it back. Nothing about you is kept (app/fieldnotes.py thumb()) ----
  function thumbs(post) {
    var mine = U.load(THUMBS_KEY, {}) || {}, count = Number(post.thumbs) || 0, busy = false;
    var num = el("span", { class: "fn-thumbs-n" });
    var btn = el("button", { type: "button", class: "fn-thumb" }, svg(THUMB), num);
    var say = el("span", { class: "fn-thumbs-say", "aria-live": "polite" });
    function show() {
      var on = !!mine[post.slug];
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", on ? "You gave this a thumbs up. Tap to take it back" : "Give this post a thumbs up");
      num.textContent = count ? String(count) : "";
      say.textContent = on ? "Thanks! Glad you enjoyed it." : "Enjoyed this one?";
    }
    btn.addEventListener("click", function () {
      if (busy) return;
      busy = true;
      var on = !mine[post.slug], token = mine[post.slug];
      // show it straight away; the server's count replaces this guess
      if (on) { mine[post.slug] = "…"; count += 1; } else { delete mine[post.slug]; count = Math.max(0, count - 1); }
      show();
      fetch(API + "/fieldnotes/" + post.slug + "/thumb", { method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(on ? { on: true } : { on: false, token: token }) })
        .then(function (r) { return r.json(); })
        .then(function (b) {
          if (!b.ok) throw new Error("bad");
          if (on) mine[post.slug] = b.token; else delete mine[post.slug];
          count = b.count;
        })
        .catch(function () {   // didn't go through: put it back how it was
          if (on) { delete mine[post.slug]; count = Math.max(0, count - 1); } else { mine[post.slug] = token; count += 1; }
          say.textContent = "That didn't go through. Try again in a moment.";
        })
        .then(function () {
          busy = false;
          U.save(THUMBS_KEY, mine);
          var keep = say.textContent; show();
          if (/didn't go through/.test(keep)) say.textContent = keep;
        });
    });
    show();
    var box = el("div", { class: "fn-thumbs" }, say, btn);
    box.setCount = function (n) { if (!busy && n != null) { count = Number(n) || 0; show(); } };   // the live count, once the intake answers
    return box;
  }
  function setThumbs(root, n) {
    var box = root.querySelector(".fn-thumbs");
    if (box && box.setCount) box.setCount(n);
  }

  function block(b, preview, byId, packs) {
    if (b.type === "p") return el("p", {}, lines(b.text));
    if (b.type === "h2" || b.type === "h3") return el(b.type, { text: b.text });
    if (b.type === "quote") return el("blockquote", { class: "fn-quote" }, el("p", {}, lines(b.text)));
    if (b.type === "list") return el("ul", {}, b.items.map(function (t) { return el("li", {}, inline(t)); }));
    if (b.type === "photos") return gallery(b.photos, preview);
    if (b.type === "mission") return missionCard(byId[b.mission], packs);
    if (b.type === "code") return el("pre", { class: "fn-code" }, el("code", { text: b.text }));   // exactly as typed
    return null;
  }

  function gallery(photos, preview) {
    if (!photos.length) return null;
    var g = el("div", { class: "fn-gallery n" + Math.min(photos.length, 3) });
    photos.forEach(function (p, i) {
      var img = photo(p, preview, { alt: p.caption || "" }, missing_photo(p));
      g.append(el("figure", { class: i === 0 ? "first" : null },
        el("a", { href: img.src, target: "_blank", rel: "noopener", "aria-label": "Open the photo full size" + (p.caption ? ": " + p.caption : "") }, img),
        p.caption ? el("figcaption", { text: p.caption }) : null));
    });
    return g;
  }

  function missionCard(m, packs) {
    if (!m) return null;   // a mission that's no longer on the site
    var tags = [LABEL.mode[m.mode], LABEL.duration[m.duration], LABEL.cost[m.cost]].filter(Boolean);
    return el("a", { class: "fn-mission", href: "/missions/" + m.id + "/" },
      el("small", { text: (packs[m.pack] || "AmbleBee") + " · Mission " + m.number }),
      el("b", { text: m.name }),
      m.short ? el("span", { class: "fn-mshort", text: m.short }) : null,
      el("span", { class: "fn-tags" }, tags.map(function (t, i) { return el("span", { class: i ? null : "g", text: t }); })),
      el("span", { class: "fn-mgo", text: "Open the mission →" }));
  }

  var list = document.getElementById("fn-page");
  if (list) listPage(list);
  else {
    var m = POST_PATH.exec(location.pathname);
    if (m) postPage(m[1]);
  }
})();
