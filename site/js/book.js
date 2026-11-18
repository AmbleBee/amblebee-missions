/* The stamp book, on top of the profile page (/me/): every stamp you've earned, in the order you earned it, like a
   passport filling up. After the book come the "Find a stamp" pages (Firsts, Places, ...) for looking one up; they
   switch in place without touching the address, whose # is kept for the profile key in Phase 3.
   Stamps are worked out by site/js/stamps.js from the missions marked done in this browser (site/js/done.js).
   Empty spots are plain dashed squares at the end of the book: no names, no "3 more to go". */
(function () {
  "use strict";
  var D = window.AmbleDone, ST = window.AmbleStamps;
  var app = document.querySelector(".book-app");
  if (!app || !D || !ST) return;

  var PER_PAGE = 6;   // 3 x 2 on each page
  var wide = window.matchMedia("(min-width: 760px)");
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pretty(iso) { var t = new Date(iso); return MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear(); }
  // Our Year of Adventures carries how many missions that year holds: "14 missions", "14 missions so far" this year
  function yearCount(s, long) {
    if (!s.year) return "";
    var n = s.year_count + (s.year_count === 1 ? " mission" : " missions");
    if (!long) return n;
    return n + " in " + s.year + (s.year === new Date().getFullYear() ? " so far." : ".");
  }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  // each stamp is inked in at its own slight tilt, the same every time
  function tilt(key) {
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 9) - 4) * 1.1;
  }

  var stamps = [], spread = 0, view = "book";
  var live = el("p", { class: "sr", "aria-live": "polite" });
  function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 50); }

  // ---- one stamp, and the pop-up when it's tapped ----
  var dialog = el("dialog", { class: "stamp-dialog", "aria-labelledby": "stamp-dialog-title" });
  document.body.append(dialog);
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });   // a tap outside closes it
  var opener = null;
  dialog.addEventListener("close", function () { if (opener && opener.isConnected) opener.focus(); });
  function open(s, from) {
    opener = from;
    dialog.replaceChildren(el("div", { class: "dialog-body stamp-dialog-body" },
      el("img", { class: "stamp-img", src: s.art, alt: "", width: "240", height: "312" }),
      el("h2", { id: "stamp-dialog-title", text: s.name }),
      s.slug ? el("p", {}, "Earned ", el("time", { datetime: s.earned_at, text: pretty(s.earned_at) }), " with ",
        el("a", { href: "/missions/" + encodeURIComponent(s.slug) + "/", text: s.mission_name }), ".")
        : el("p", {}, "Earned ", el("time", { datetime: s.earned_at, text: pretty(s.earned_at) }), " by voting in ",
          el("a", { href: "/contribute/#polls", text: "an AmbleBee poll" }), "."),
      s.year ? el("p", { class: "stamp-year-count", text: yearCount(s, true) }) : null,
      s.how ? el("div", { class: "stamp-how" }, el("h3", { text: "How you earned it" }), el("p", { text: s.how })) : null,
      el("form", { method: "dialog" }, el("button", { class: "btn small", type: "submit", text: "Close" }))));
    dialog.showModal();
  }
  function tile(s) {
    var btn = el("button", { type: "button", class: "stamp", "data-key": s.key,
      "aria-label": s.name + ", earned " + pretty(s.earned_at) + " with " + s.mission_name + (s.year ? ", " + yearCount(s) : ""),
      onclick: function () { open(s, btn); } },
      el("img", { class: "stamp-img", src: s.art, alt: "", width: "120", height: "156", loading: "lazy", style: "transform: rotate(" + tilt(s.key) + "deg)" }));
    return el("li", { class: "stamp-spot" }, btn,
      el("p", { class: "stamp-cap", "aria-hidden": "true" },
        el("b", { text: s.name }), el("span", { text: s.mission_name }), el("time", { datetime: s.earned_at, text: pretty(s.earned_at) }),
        s.year ? el("span", { class: "stamp-count", text: yearCount(s) }) : null));
  }
  function blank() { return el("li", { class: "stamp-spot open-spot", "aria-hidden": "true" }, el("span", { class: "stamp-blank" })); }

  // ---- the side menu: In order, then the Find a stamp pages with how many you have on each ----
  function menu() {
    var counts = {};
    stamps.forEach(function (s) { counts[s.page] = (counts[s.page] || 0) + 1; });
    function item(id, name, n) {
      var here = view === id;
      return el("li", {}, el("button", { type: "button", "data-view": id, class: here ? "on" : null, "aria-pressed": here ? "true" : "false",
        onclick: function () {
          view = id; draw();
          var h = app.querySelector(id === "book" ? '.book-menu [data-view="book"]' : "#book-title");
          if (h) h.focus();
        } },
        el("span", { text: name }), n != null ? el("small", { text: String(n) }) : null));
    }
    var find = el("ul", {});
    ST.pages.forEach(function (p) { find.append(item(p.id, p.name, counts[p.id] || 0)); });
    return el("nav", { class: "book-menu", "aria-label": "Stamp book pages" },
      el("ul", {}, item("book", "In order", stamps.length)),
      el("p", { class: "book-menu-head", text: "Find a stamp" }), find);
  }

  // ---- the book, in order ----
  function pagesNeeded() {
    var per = wide.matches ? 2 : 1;
    var pages = Math.ceil((stamps.length + 1) / PER_PAGE);   // always room for the next stamp
    return Math.ceil(pages / per) * per;                       // whole spreads
  }
  function book(focusKey) {
    var per = wide.matches ? 2 : 1;
    var pages = pagesNeeded();
    var spreads = pages / per;
    spread = Math.max(0, Math.min(spread, spreads - 1));
    var first = spread * per;
    var openBook = el("div", { class: "book" + (per === 2 ? " two" : "") });
    for (var p = first; p < first + per; p++) {
      var ul = el("ul", { class: "book-page", "aria-label": "Page " + (p + 1) });
      for (var i = p * PER_PAGE; i < (p + 1) * PER_PAGE; i++) ul.append(stamps[i] ? tile(stamps[i]) : blank());
      openBook.append(ul);
    }
    var label = per === 2 ? "Pages " + (first + 1) + "–" + (first + 2) + " of " + pages : "Page " + (first + 1) + " of " + pages;
    var back = el("button", { type: "button", class: "btn small book-back", disabled: spread === 0, "aria-label": "Previous pages",
      onclick: function () { spread--; draw(); say(app.querySelector(".book-where").textContent); focusNav(".book-back"); } }, "‹ Back");
    var next = el("button", { type: "button", class: "btn small book-next", disabled: spread >= spreads - 1, "aria-label": "Next pages",
      onclick: function () { spread++; draw(); say(app.querySelector(".book-where").textContent); focusNav(".book-next"); } }, "Next ›");
    var newest = stamps.length ? el("button", { type: "button", class: "linkish book-newest", onclick: function () {
      var last = stamps[stamps.length - 1];
      spread = Math.floor(Math.floor((stamps.length - 1) / PER_PAGE) / per);
      draw(last.key);
    } }, "Newest stamp") : null;
    var out = el("section", { class: "book-view", "aria-labelledby": "book-title" },
      el("h3", { id: "book-title", class: "sr", text: "In order" }),
      stamps.length ? null : el("p", { class: "book-none", text: "Your first stamp lands when you mark a mission done. Every stamp you earn goes in here, in the order you earn it." }),
      openBook,
      el("div", { class: "book-nav" }, back, el("span", { class: "book-where", text: label }), next, newest));
    if (focusKey) setTimeout(function () { var b = out.querySelector('.stamp[data-key="' + focusKey + '"]'); if (b) b.focus(); }, 0);
    return out;
  }
  function focusNav(sel) {
    var b = app.querySelector(sel);
    if (b && !b.disabled) b.focus(); else { var w = app.querySelector(".book-where"); if (w) { w.tabIndex = -1; w.focus(); } }
  }

  // ---- a Find a stamp page ----
  function findPage(id) {
    var p = ST.pages.find(function (x) { return x.id === id; });
    var mine = stamps.filter(function (s) { return s.page === id; });
    var ul = el("ul", { class: "book-page find" });
    mine.forEach(function (s) { ul.append(tile(s)); });
    return el("section", { class: "book-view", "aria-labelledby": "book-title" },
      el("h3", { id: "book-title", tabindex: "-1", text: p.name }),
      mine.length ? ul : el("p", { class: "book-none", text: "None here yet. They turn up as you go." }));
  }

  function draw(focusKey) {
    stamps = ST.earned();
    app.replaceChildren(el("div", { class: "book-wrap" }, menu(), view === "book" ? book(focusKey) : findPage(view)), live);
  }

  // one page or two as the screen changes (older Safari, iOS 13 and before, only has addListener)
  if (wide.addEventListener) wide.addEventListener("change", function () { draw(); });
  else if (wide.addListener) wide.addListener(function () { draw(); });
  window.addEventListener("amble:done", function () { draw(); });
  window.addEventListener("storage", function (e) { if (e.key === "amble.done") draw(); });
  ST.fresh();   // looking at the book counts as having seen them: they won't "land" again later
  draw();
})();
