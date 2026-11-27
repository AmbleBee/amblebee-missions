/* Small helpers every page's scripts share. Loaded on every page (the shared <head> in tools/build_pages.py) before
   any other script, so the others can start with `var U = window.AmbleUtil;`. */
(function () {
  "use strict";

  // add a child (a node, text, or a list of them) to an element; null and false are skipped
  function add(e, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(e, k); }); return; }
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }

  // el("p", { class: "x", text: "hi", onclick: fn, hidden: true }, child, child...)
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
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }

  function pad(n) { return ("0" + n).slice(-2); }
  function ymd(t) { return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); }   // the visitor's own calendar day
  function today() { return ymd(new Date()); }

  // this browser's storage, as JSON; private modes that refuse it just get the fallback
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ } }

  // A US ZIP code's state, from its first three digits (USPS ranges), as a two-letter code; "" for military, territories
  // and anything unknown. Used only to count which state someone looked from: the ZIP itself is never sent anywhere.
  var ZIP3 = [[5, 5, "ny"], [10, 27, "ma"], [28, 29, "ri"], [30, 38, "nh"], [39, 49, "me"], [50, 54, "vt"], [55, 55, "ma"],
    [56, 59, "vt"], [60, 69, "ct"], [70, 89, "nj"], [100, 149, "ny"], [150, 196, "pa"], [197, 199, "de"], [200, 200, "dc"],
    [201, 201, "va"], [202, 205, "dc"], [206, 219, "md"], [220, 246, "va"], [247, 268, "wv"], [270, 289, "nc"], [290, 299, "sc"],
    [300, 319, "ga"], [320, 339, "fl"], [341, 349, "fl"], [350, 369, "al"], [370, 385, "tn"], [386, 397, "ms"], [398, 399, "ga"],
    [400, 427, "ky"], [430, 459, "oh"], [460, 479, "in"], [480, 499, "mi"], [500, 528, "ia"], [530, 549, "wi"], [550, 567, "mn"],
    [569, 569, "dc"], [570, 577, "sd"], [580, 588, "nd"], [590, 599, "mt"], [600, 629, "il"], [630, 658, "mo"], [660, 679, "ks"],
    [680, 693, "ne"], [700, 714, "la"], [716, 729, "ar"], [730, 732, "ok"], [733, 733, "tx"], [734, 749, "ok"], [750, 799, "tx"],
    [800, 816, "co"], [820, 831, "wy"], [832, 838, "id"], [840, 847, "ut"], [850, 865, "az"], [870, 884, "nm"], [885, 885, "tx"],
    [889, 898, "nv"], [900, 961, "ca"], [967, 968, "hi"], [970, 979, "or"], [980, 994, "wa"], [995, 999, "ak"]];
  function zipState(zip) {
    if (!/^\d{5}$/.test(zip || "")) return "";
    var n = +zip.slice(0, 3);
    for (var i = 0; i < ZIP3.length; i++) if (n >= ZIP3[i][0] && n <= ZIP3[i][1]) return ZIP3[i][2];
    return "";
  }
  // "97201" or "Portland, OR": its state as a two-letter code, or "" ("your location", outside the US)
  function placeState(label) {
    var m = /,\s*([A-Za-z]{2})$/.exec(label || "");
    return m ? m[1].toLowerCase() : zipState(label);
  }

  // The "These work anywhere" note on Anywhere missions (the homepage's open mission and each mission's own page).
  // Hidden for good once someone closes it: kept in this browser (localStorage), or for this visit if the browser won't.
  var NOTE = "amble.nearnote", noteGone = false;
  function noteHidden() {
    if (noteGone) return true;
    try { if (localStorage.getItem(NOTE)) return true; } catch (e) { /* try the visit's own storage */ }
    try { if (sessionStorage.getItem(NOTE)) return true; } catch (e) { /* in memory, then */ }
    return false;
  }
  function hideNote() {
    noteGone = true;
    try { localStorage.setItem(NOTE, "hidden"); } catch (e) { try { sessionStorage.setItem(NOTE, "hidden"); } catch (e2) { /* in memory */ } }
    if (window.ambleTrack) window.ambleTrack("near_note", { item: "hide" });
  }
  function hasPlace() { try { return !!localStorage.getItem("amble.zip"); } catch (e) { return false; } }
  // tapped the note's link: remembered for this visit, so a ZIP set right after counts as coming from the note
  function noteTapped() {
    try { sessionStorage.setItem("amble.fromnote", "1"); } catch (e) { /* fine */ }
    if (window.ambleTrack) window.ambleTrack("near_note", { item: "tap" });
  }
  function noteFollowed() {
    try { if (!sessionStorage.getItem("amble.fromnote")) return false; sessionStorage.removeItem("amble.fromnote"); return true; } catch (e) { return false; }
  }
  // a mission's own page (tools/build_pages.py writes the note, hidden, on Anywhere missions only)
  var pageNote = document.querySelector("[data-near-note]");
  if (pageNote && !noteHidden() && !hasPlace()) {
    pageNote.hidden = false;
    var x = pageNote.querySelector(".note-x"), go = pageNote.querySelector("a");
    if (x) x.addEventListener("click", function () { hideNote(); pageNote.hidden = true; });
    if (go) go.addEventListener("click", noteTapped);
  }

  window.AmbleUtil = {
    API: "https://amblebee-intake.tail58116.ts.net",   // AmbleBee Intake; also in connect-src (CSP in tools/build_pages.py)
    add: add, el: el, pad: pad, ymd: ymd, today: today, load: load, save: save,
    placeState: placeState, noteHidden: noteHidden, hideNote: hideNote, noteTapped: noteTapped, noteFollowed: noteFollowed
  };
})();
