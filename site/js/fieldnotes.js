/* Field notes, the AmbleBee blog. The posts and their photos live on AmbleBee Intake (app/fieldnotes.py there), so
   publishing or editing one never rebuilds this site:
     /fieldnotes/          pages/fieldnotes.html: the list, with search and topic chips
     /fieldnotes/<post>/   isn't a file here, so GitHub Pages answers with 404.html, and this script turns that page
                           into the post. ?preview=<token> (the intake's Preview button) shows a draft. */
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
  var THUMBS_KEY = "amble.fieldnotes.thumbs";   // {post: the token its thumbs up got}, so this browser can take it back

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
  function photo(p, preview, attrs) {
    var src = API + p.url + (preview ? "?preview=" + encodeURIComponent(preview) : "");
    return el("img", Object.assign({ src: src, alt: "", width: p.width || null, height: p.height || null, loading: "lazy", decoding: "async" }, attrs || {}));
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
    var bg = el("img", { class: "bg", src: API + h.backdrop, alt: "", loading: o.eager ? "eager" : "lazy", decoding: "async" });
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
    var state = { q: params.get("q") || "", topic: params.get("topic") || "", order: params.get("order") === "old" ? "old" : "new", page: 1 },
      ask = 0, timer = null;
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
      var pic = hasHeader(p) ? header(p, { compact: true }) : p.cover ? photo(p.cover, "", {}) : stand(p.slug);
      return el("a", { class: "fn-card", href: "/fieldnotes/" + p.slug + "/" },
        el("div", { class: "fn-pic" }, pic),
        el("div", { class: "fn-body" },
          el("span", { class: "fn-meta", text: day(p.posted_at) + " · " + p.minutes + " min read" }),
          el("h3", { text: p.title }),
          p.summary ? el("p", { text: p.summary }) : null,
          p.topics.length ? el("div", { class: "fn-tags" }, p.topics.map(function (t, i) { return el("span", { class: i ? null : "g", text: t }); })) : null));
    }
    function feature(p) {
      var pic = hasHeader(p) ? header(p, { eager: true }) : p.cover ? photo(p.cover, "", { loading: "eager" }) : stand(p.slug);
      return el("a", { class: "fn-feat", href: "/fieldnotes/" + p.slug + "/" },
        el("div", { class: "fn-pic" }, pic),
        el("div", { class: "fn-body" },
          el("span", { class: "fn-pin" }, svg(PIN), "Pinned"),
          el("span", { class: "fn-meta", text: day(p.posted_at, true) + " · " + p.minutes + " min read" }),
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
        count.textContent = b.total + (b.total === 1 ? " post" : " posts");
        if (!b.total) box.replaceChildren(el("p", { class: "fn-empty" }, filtered
          ? ["Nothing matches that yet. ", el("button", { type: "button", class: "linkish", text: "Show every post",
              onclick: function () { state.q = ""; state.topic = ""; search.value = ""; load(false); } })]
          : "The first field notes are on their way. Check back soon."));
        moreBtn.textContent = state.order === "old" ? "Show newer posts" : "Show older posts";
        moreBtn.hidden = !b.more;
        moreBtn.disabled = false;
      }).catch(function () {
        if (mine !== ask) return;
        box.removeAttribute("aria-busy");
        moreBtn.hidden = true;
        count.textContent = "";
        if (!more) box.replaceChildren(el("p", { class: "fn-empty" }, "Field notes couldn't load right now. Try again in a little while."));
      });
    }
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = search.value.trim(); load(false); }, 300);
    });
    root.querySelector("#fn-search-form").addEventListener("submit", function (e) {
      e.preventDefault(); clearTimeout(timer); state.q = search.value.trim(); load(false);
    });
    moreBtn.addEventListener("click", function () { load(true); });
    load(false);
  }

  // ===================================== one post: /fieldnotes/<post>/ =====================================
  function postPage(slug) {
    var preview = new URLSearchParams(location.search).get("preview") || "";
    var wrap = document.querySelector("main .page");
    var gone = document.getElementById("nf");
    var root = el("article", { class: "fn-post", "aria-busy": "true" }, el("p", { class: "fn-loading", text: "Opening the post…" }));
    wrap.className = "page page-wide pg fieldnotes";
    if (gone) gone.hidden = true;
    wrap.append(root);
    document.title = "Field notes · AmbleBee";

    var catalog = fetch("/catalog.json", { cache: "force-cache" }).then(function (r) { return r.json(); }).catch(function () { return {}; });
    get("/fieldnotes/" + slug + (preview ? "?preview=" + encodeURIComponent(preview) : "")).then(function (b) {
      if (!b.ok) return missing(root, b.status === 404);
      var needs = b.post.blocks.some(function (x) { return x.type === "mission"; });
      return (needs ? catalog : Promise.resolve({})).then(function (c) { draw(root, b.post, preview, c); });
    }).catch(function () { missing(root, false); });
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
    var cover = !hasHeader(post) && post.cover ? el("figure", { class: "fn-cover" }, photo(post.cover, preview, { loading: "eager", alt: "" })) : null;
    var firstPhotos = post.blocks.find(function (b) { return b.type === "photos"; });
    if (cover && firstPhotos && firstPhotos.photos[0] && firstPhotos.photos[0].url === post.cover.url && post.blocks.indexOf(firstPhotos) === 0) cover = null;   // it'd show twice in a row
    root.removeAttribute("aria-busy");
    root.replaceChildren(hero, el("section", { class: "pg-band fn-band" }, el("div", { class: "fn-article" }, cover, body,
      post.draft ? null : thumbs(post),
      el("p", { class: "fn-end" }, el("a", { class: "btn", href: "/fieldnotes/", text: "More field notes" }),
        el("a", { class: "btn primary", href: "/", text: "Give me a mission" })))));
    if (!post.draft && !preview) watchRead(post, body);
  }

  // ---- a read, and time on the page. A read: three quarters of the way down the post, after most of its reading time on
  // screen. Time: seconds the post is on screen, sent when the page is hidden or left (in pieces, if you come back).
  // Both go through site/js/count.js (no cookies, nothing kept in this browser); the server counts the same person once a
  // day per post for reads, and only adds up seconds for time. A fast reader gets a read at 60% of the "min read"
  // estimate, and never under 20 seconds.
  var READ_DEPTH = 0.75, READ_SHARE = 0.6, READ_MIN_SECONDS = 20;
  function watchRead(post, body) {
    var need = Math.max(READ_MIN_SECONDS, (Number(post.minutes) || 1) * 60 * READ_SHARE), seen = 0, sent = 0, deep = false, done = false;
    function track(name, params) { if (window.ambleTrack) window.ambleTrack(name, params); }
    function depth() {
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
    return el("div", { class: "fn-thumbs" }, say, btn);
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
      var img = photo(p, preview, { alt: p.caption || "" });
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
