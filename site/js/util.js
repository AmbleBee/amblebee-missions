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

  window.AmbleUtil = {
    API: "https://amblebee-intake.tail58116.ts.net",   // AmbleBee Intake; also in connect-src (CSP in tools/build_pages.py)
    add: add, el: el, pad: pad, ymd: ymd, today: today, load: load, save: save
  };
})();
