/* Visits, counted by AmbleBee's own server (amblebee-intake's app/visits.py): no cookies, nothing stored in this
   browser, no IP addresses kept. One short note per page (which page, and the site you came from), and a few actions
   by name: a mission opened, a plan added to a calendar, a vote started, a Field notes post read most of the way.
   Only on amblebee.com itself, never in test browsers, and not for browsers that send Global Privacy Control.
   Max's own browsers: open amblebee.com/?nocount=1 once to stop counting this browser (?nocount=0 to undo). */
(function () {
  var API = window.AmbleUtil.API + "/hit";
  try {
    var q = new URLSearchParams(location.search).get("nocount");
    if (q === "1") localStorage.setItem("amble.nocount", "1");
    if (q === "0") localStorage.removeItem("amble.nocount");
    if (localStorage.getItem("amble.nocount")) return;
  } catch (e) { /* private mode: count as usual */ }
  if (!/^(www\.)?amblebee\.com$/.test(location.hostname) || navigator.webdriver || navigator.globalPrivacyControl) return;

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
  send({ p: location.pathname, r: ref });

  // a few actions the site already names (site/js/stats.js's ambleTrack), counted here too
  var ACTIONS = { mission_open: "open", calendar_added: "plan", vote_started: "vote", fieldnote_read: "read" };
  var before = window.ambleTrack;
  window.ambleTrack = function (name, params) {
    var a = ACTIONS[name];
    if (a) send({ a: a, i: (params && (params.mission_id || params.item || "")) || "" });
    if (before) before(name, params);
  };
})();
