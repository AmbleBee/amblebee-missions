/* Visits, counted by AmbleBee's own server (amblebee-intake's app/visits.py): no cookies, nothing stored in this
   browser, no IP addresses kept. One short note per page (which page, and the site you came from), and a few actions
   by name: a mission opened, a plan added to a calendar, a vote started, a Field notes post read most of the way, and
   how long a Field notes post was on screen (seconds, added to that post's total). And a few more daily totals for
   Stats → Insights: a search that found nothing (not the words), directions or a place's website opened from a mission,
   how many missions one homepage visit dealt, a filter picked, a mission opened from a Field notes post, and a link to
   a page that doesn't exist.
   Only on amblebee.com itself, never in test or scripted browsers, and not for browsers that send Global Privacy Control.
   Real visitors: once per page, a note that someone did something a person does here (tapped, clicked, typed, moved the
   mouse or turned the wheel) or kept the page on screen for 10 seconds. Just that it happened, nothing about what. Stats
   shows real visitors next to everyone counted, so scripts that load pages without ever acting like a person stand out.
   Looked at: a mission opened and then actually looked at (8 seconds on screen, scrolled, or something in it tapped), so a
   quick skim to the next one doesn't read as interest. Once per mission per page.
   Two more daily totals: the "These work anywhere" note (closed, tapped, or a ZIP set after tapping it), and the state a
   typed ZIP or city is in (the state only: site/js/main.js works it out here, and the ZIP never leaves the browser).
   Max's own browsers: open amblebee.com/?nocount=1 once to stop counting this browser (?nocount=0 to undo). */
(function () {
  var API = window.AmbleUtil.API + "/hit";
  try {
    var q = new URLSearchParams(location.search).get("nocount");
    if (q === "1") localStorage.setItem("amble.nocount", "1");
    if (q === "0") localStorage.removeItem("amble.nocount");
    if (q !== null && history.replaceState) {   // out of the address bar, so a copied or shared link doesn't carry it
      var u = new URL(location.href);
      u.searchParams.delete("nocount");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    }
    if (localStorage.getItem("amble.nocount")) return;
  } catch (e) { /* private mode: count as usual */ }
  if (!/^(www\.)?amblebee\.com$/.test(location.hostname) || navigator.webdriver || navigator.globalPrivacyControl) return;
  // scripted browsers that don't say so with navigator.webdriver
  if (/HeadlessChrome|PhantomJS|jsdom/i.test(navigator.userAgent || "") || window.callPhantom || window._phantom ||
      window.__nightmare || window.domAutomation || window.domAutomationController) return;

  function send(data) {
    var body = JSON.stringify(data);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(API, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(API, { method: "POST", body: body, keepalive: true, mode: "cors", headers: { "Content-Type": "text/plain" } }); } catch (e) { /* never mind */ }
  }

  // the page, without the search words or the #part; the referrer only when it's another site
  var ref = "";
  try { var r = new URL(document.referrer); if (!/(^|\.)amblebee\.com$/.test(r.hostname)) ref = r.origin; } catch (e) { /* none */ }
  // the "this trail doesn't go anywhere" page (404.html) at an address that isn't a page: a broken link somewhere.
  // Field notes posts use that page too (site/js/fieldnotes.js), so they don't count.
  var missing = document.getElementById("nf") && !/^\/fieldnotes\/[^/]+\/$/.test(location.pathname);
  send(missing ? { p: location.pathname, r: ref, nf: 1 } : { p: location.pathname, r: ref });

  // a real visitor: the first thing a person does here (the browser marks it isTrusted; a script's events aren't), or
  // 10 seconds with the page on screen. Sent once per page.
  var human = false, shown = 0, clock = null;
  var KINDS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
  function person(e) {
    if (human || (e && e.isTrusted === false)) return;
    human = true;
    KINDS.forEach(function (k) { document.removeEventListener(k, person, true); });
    if (clock) clearInterval(clock);
    send({ a: "human" });
  }
  KINDS.forEach(function (k) { document.addEventListener(k, person, { capture: true, passive: true }); });
  clock = setInterval(function () {
    if (document.visibilityState === "visible" && ++shown >= 10) person();
  }, 1000);

  // looked at: the mission on screen now (the homepage's open one, or a mission's own page) counts as looked at after 8
  // seconds in view, a scroll, or a tap or key inside it. Tapping "Open another" isn't looking, so a skim doesn't count.
  var looking = null, lookSecs = 0, looked = {};
  var slugOf = function (id) { return String(id || "").split("/").pop(); };
  function watch(id) { looking = looked[slugOf(id)] ? null : id; lookSecs = 0; }
  function lookedAt() {
    if (!looking) return;
    looked[slugOf(looking)] = 1;
    send({ a: "look", i: looking });
    looking = null;
  }
  setInterval(function () {
    if (!looking) return;
    if (slugOf(looking) !== missionHere()) { looking = null; return; }   // moved on before it counted
    if (document.visibilityState === "visible" && ++lookSecs >= 8) lookedAt();
  }, 1000);
  var INSIDE = "#reveal-slot, #reveal-done, .ticket, .done-slot, .mission-about";
  document.addEventListener("pointerdown", function (e) {
    if (looking && e.isTrusted && e.target.closest && e.target.closest(INSIDE)) lookedAt();
  }, true);
  ["wheel", "touchmove"].forEach(function (k) {
    document.addEventListener(k, function (e) { if (looking && e.isTrusted) lookedAt(); }, { capture: true, passive: true });
  });
  document.addEventListener("keydown", function (e) {
    if (looking && e.isTrusted && /^(ArrowDown|PageDown|End| )$/.test(e.key)) lookedAt();
  }, true);
  var own = location.pathname.match(/^\/missions\/([a-z0-9-]+)\/$/);
  if (own) watch(own[1]);

  // a few actions the site already names (site/js/stats.js's ambleTrack), counted here too
  var ACTIONS = { mission_open: "open", calendar_added: "plan", vote_started: "vote", fieldnote_read: "read" };
  var OURS = { search_none: "nores", fieldnote_mission: "fnclick", near_note: "nnote", zip_state: "zipst" };   // ours only: not passed on to Google Analytics
  var rolls = 0;
  var before = window.ambleTrack;
  window.ambleTrack = function (name, params) {
    if (name === "fieldnote_time") {
      if (params && params.item) send({ a: "time", i: params.item, s: Math.round(params.seconds || 0), v: params.first ? 1 : 0 });
      return;
    }
    if (OURS[name]) { send({ a: OURS[name], i: (params && params.item) || "" }); return; }
    if (name === "mission_open" && params && params.how === "roll") rolls++;
    if (name === "mission_open" && params && params.mission_id) watch(String(params.mission_id));
    var a = ACTIONS[name];
    if (a) send({ a: a, i: (params && (params.mission_id || params.item || "")) || "" });
    if (before) before(name, params);
  };

  // which mission a link was clicked from: its own page, or the one open on the homepage
  function missionHere() {
    var m = location.pathname.match(/^\/missions\/([a-z0-9-]+)\/$/);
    if (m) return m[1];
    try { return S && S.current ? String(S.current.full_id || S.current.id || "").split("/").pop() : ""; } catch (e) { return ""; }
  }
  // directions and a place's own links, from a mission's place box (site/js/ticket.js, tools/build_pages.py)
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".place a[href]");
    if (!a) return;
    var id = missionHere();
    if (!id) return;
    var dirs = /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com)/.test(a.href);
    send({ a: dirs ? "dirs" : "web", i: id });
  }, true);
  // filters picked (only turning one on), on the homepage and the All missions page
  var COST = { "$": "under-20", "$$": "20-60", "$$$": "over-60" };
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "INPUT" || !t.checked) return;
    var box = t.closest("[data-filter], [data-pf]"), group = "", value = String(t.value || "");
    if (box) group = box.getAttribute("data-filter") || box.getAttribute("data-pf");
    else if (t.name === "mode") group = "mode";
    else if (t.id === "f-season" || t.classList.contains("pf-season")) { group = "now"; value = "in-season"; }
    else if (t.id === "f-gonow") { group = "now"; value = "go-now"; }
    if (!group || (group === "mode" && value === "any")) return;
    if (group === "cost") value = COST[value] || value;
    var item = (group + "-" + value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 60);
    send({ a: "filter", i: item });
  }, true);
  // how many missions one homepage visit dealt with "Open another", sent once when the page is hidden or left
  if (location.pathname === "/") {
    var told = false;
    var tell = function () {
      if (told || !rolls) return;
      told = true;
      send({ a: "rolls", i: rolls === 1 ? "1" : rolls === 2 ? "2" : rolls <= 5 ? "3-5" : rolls <= 10 ? "6-10" : "11-plus" });
    };
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") tell(); });
    window.addEventListener("pagehide", tell);
  }
})();
