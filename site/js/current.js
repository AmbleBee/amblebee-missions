/* The mission you're on: "Start mission" on a ticket, then a small bar under the site's header on every page until
   it's marked done or stopped. Its photo prompts can be ticked off from the bar as you go.

   The mission itself is kept by site/js/done.js (AmbleDone.current / start / stop / got), so backups and the profile
   carry it to your other devices, and marking it done anywhere (the bar, its page, the popup) ends it.
   Pages that don't load done.js get it loaded here. Also fills the "On a mission" card on Your profile (/me/).

   Used by site/js/plans.js: AmbleCurrent.button(m) puts "Start mission" next to "Plan this mission". */
(function () {
  "use strict";
  var U = window.AmbleUtil, el = U.el;
  var OPEN_KEY = "amble.mbar.open";   // whether the prompts are showing, for this tab only

  var ICONS = {
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
  };
  function icon(name, size) {
    var t = document.createElement("template");
    t.innerHTML = '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return t.content.firstChild;
  }
  function track(name, params) { if (window.ambleTrack) window.ambleTrack(name, params); }
  var page = function (cur) { return "/missions/" + encodeURIComponent(cur.slug) + "/"; };
  function isOpen() { try { return sessionStorage.getItem(OPEN_KEY) === "1"; } catch (e) { return false; } }
  function setOpen(v) { try { sessionStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch (e) { /* private mode */ } }

  // done.js is on most pages already; the few without it (About, FAQ…) get it now
  var waiting = [];
  function withDone(fn) {
    if (window.AmbleDone) return fn(window.AmbleDone);
    waiting.push(fn);
    if (waiting.length > 1) return;
    var s = document.createElement("script");
    s.src = "/js/done.js";
    s.onload = function () { var q = waiting; waiting = []; if (window.AmbleDone) q.forEach(function (f) { f(window.AmbleDone); }); };
    document.head.appendChild(s);
  }

  // ---- the photo prompts, as a list you tick off ----
  function prompts(D, cur) {
    return el("ol", { class: "mbar-steps" }, cur.steps.map(function (text, i) {
      var on = cur.got.indexOf(i) >= 0;
      return el("li", {}, el("button", { type: "button", class: "mbar-step" + (on ? " is-got" : ""), "aria-pressed": String(on),
        onclick: function () { D.got(i, !on); } }, el("span", { class: "mbar-tick" }, icon("check", 16)), el("span", { text: text })));
    }));
  }
  function progress(cur) {
    return cur.steps.length ? cur.got.length + " of " + cur.steps.length + " photo prompts" : "";
  }

  // Mark done happens in the mission's own "Mark done" box, so how it went, the note and any stamp work as always
  function markDone(cur) {
    track("mission_bar_done", { mission_id: cur.slug });
    if (!focusDoneBox(cur)) location.href = page(cur) + "#done";
  }
  function focusDoneBox(cur) {
    var slot = Array.prototype.find.call(document.querySelectorAll(".done-slot[data-mission]"), function (s) {
      try { return JSON.parse(s.getAttribute("data-mission")).mission === cur.mission; } catch (e) { return false; }
    });
    var btn = slot && slot.querySelector(".done-mark");
    if (!btn) return false;
    var box = slot.querySelector(".done-box") || slot;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.classList.remove("is-called"); void box.offsetWidth; box.classList.add("is-called");
    btn.focus({ preventScroll: true });
    return true;
  }

  // ---- the bar ----
  var confirming = false;
  function drawBar(D) {
    var cur = D.current(), bar = document.getElementById("on-mission");
    if (!cur) { if (bar) bar.remove(); confirming = false; return; }
    if (!bar) {
      bar = el("div", { id: "on-mission", class: "mbar", role: "region", "aria-label": "The mission you're on" });
      var top = document.querySelector("header.top");
      if (top) top.after(bar); else document.body.prepend(bar);
    }
    var open = isOpen() && cur.steps.length > 0;
    var acts = confirming
      ? el("div", { class: "mbar-acts" }, el("span", { class: "mbar-ask", text: "Stop this mission?" }),
          el("button", { type: "button", class: "btn small mbar-stop-yes", onclick: function () { confirming = false; D.stop(); } }, "Stop it"),
          el("button", { type: "button", class: "btn small", onclick: function () { confirming = false; drawBar(D); } }, "Keep going"))
      : el("div", { class: "mbar-acts" },
          cur.steps.length ? el("button", { type: "button", class: "btn small mbar-toggle", "aria-expanded": String(open), "aria-controls": "mbar-panel",
            onclick: function () { setOpen(!open); drawBar(D); } }, "Prompts", icon("down", 18)) : null,
          el("button", { type: "button", class: "btn small primary mbar-done", onclick: function () { markDone(cur); } }, icon("check", 18), "Mark done"),
          el("button", { type: "button", class: "mbar-x", "aria-label": "Stop this mission", title: "Stop this mission",
            onclick: function () { confirming = true; drawBar(D); } }, icon("x", 20)));
    bar.replaceChildren();
    U.add(bar, [
      el("div", { class: "mbar-row" },
        el("span", { class: "mbar-icon" }, icon("flag", 20)),
        el("div", { class: "mbar-what" },
          el("span", { class: "mbar-lbl", text: "On a mission" }),
          el("a", { class: "mbar-name", href: page(cur), text: cur.name }),
          progress(cur) ? el("span", { class: "mbar-prog", text: progress(cur) }) : null),
        acts),
      open ? el("div", { class: "mbar-panel", id: "mbar-panel" }, prompts(D, cur),
        el("p", { class: "mbar-hint", text: "Take them with your own camera. Ticking them off just helps you keep track." })) : null]);
  }

  // ---- "On a mission" on Your profile ----
  function drawCard(D) {
    var slot = document.querySelector(".current-slot");
    if (!slot) return;
    var cur = D.current();
    slot.hidden = !cur;
    if (!cur) { slot.replaceChildren(); return; }
    var started = new Date(cur.started_at);
    slot.replaceChildren();
    U.add(slot, [
      el("h2", { id: "current-title", text: "On a mission" }),
      el("div", { class: "current-card" },
        el("a", { class: "current-name", href: page(cur), text: cur.name }),
        el("p", { class: "current-when", text: "Started " + started.toLocaleDateString(undefined, { month: "long", day: "numeric" }) +
          (progress(cur) ? " · " + progress(cur) : "") }),
        cur.steps.length ? prompts(D, cur) : null,
        el("div", { class: "current-acts" },
          el("button", { type: "button", class: "btn small primary", onclick: function () { markDone(cur); } }, icon("check", 18), "Mark done"),
          el("a", { class: "btn small", href: page(cur) }, "Open the mission"),
          el("button", { type: "button", class: "linkish", onclick: function () {
            if (confirm("Stop \"" + cur.name + "\"? Your ticked prompts are cleared; the mission isn't marked done.")) D.stop();
          } }, "Stop this mission")))]);
  }

  // ---- "Start mission" on a ticket ----
  // m: a mission from catalog.json, or a mission page's plan-slot data (the same fields)
  function info(m) {
    return { mission: m.full_id, slug: m.id, name: m.name, pack: m.pack, mode: m.mode, setting: m.setting || "either",
      time_of_day: m.time_of_day || "any", themes: m.themes || [], steps: m.steps || [] };
  }
  function button(m) {
    if (!m || !m.full_id) return null;
    var b = el("button", { type: "button", class: "btn small mstart" });
    function paint(D) {
      var cur = D && D.current(), mine = cur && cur.mission === m.full_id;
      b.replaceChildren(icon(mine ? "check" : "flag", 20), mine ? "You're on this one" : "Start mission");
      b.classList.toggle("is-on", !!mine);
      b.setAttribute("aria-pressed", String(!!mine));
    }
    b.addEventListener("click", function () {
      withDone(function (D) {
        var cur = D.current();
        if (cur && cur.mission === m.full_id) { setOpen(true); drawBar(D); var bar = document.getElementById("on-mission"); if (bar) bar.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
        if (cur && !confirm("You're on \"" + cur.name + "\". Stop it and start this one instead?")) return;
        D.start(info(m));
        setOpen(true);   // the prompts show right away, so it's clear what to do next
        drawBar(D);
      });
    });
    withDone(paint);
    window.addEventListener("amble:done", function () { if (b.isConnected && window.AmbleDone) paint(window.AmbleDone); });
    return b;
  }
  window.AmbleCurrent = { button: button };

  function drawAll(D) { drawBar(D); drawCard(D); }
  function start() {
    withDone(function (D) {
      drawAll(D);
      window.addEventListener("amble:done", function () { drawAll(D); });
      window.addEventListener("storage", function (e) { if (e.key === "amble.done") drawAll(D); });   // another tab
      // the bar's Mark done on another page lands here: point at this mission's Mark done button
      if (location.hash === "#done") setTimeout(function () { var cur = D.current(); if (cur) focusDoneBox(cur); }, 60);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
