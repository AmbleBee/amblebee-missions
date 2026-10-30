/* The bee trail: draws roadmap.json (built from roadmap.yaml) as a timeline.
   Nothing to edit here when the roadmap changes; edit roadmap.yaml instead. */
(function () {
  "use strict";

  // ---- setting you might edit ----
  // How many done entries get full cards on the trail. Older ones fold into "Earlier on the trail".
  var TRAIL_DONE = 20;

  var STATUS = {
    doing: "Buzzing on it",
    next: "Up next",
    later: "Someday",
    done: "Done"
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
                     "September", "October", "November", "December"];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* **bold**, `code`, [text](https://link). Everything else stays plain text. */
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\.?\/?[\w\-./#=?&]+)\)/g, function (_, text, url) {
        var outside = /^https?:/.test(url) && url.indexOf("amblebee.com") === -1;
        return '<a href="' + url + '"' + (outside ? ' target="_blank" rel="noopener"' : "") + ">" + text + "</a>";
      });
  }

  function parts(iso) { var p = iso.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
  function shortDate(iso) { var p = parts(iso); return MONTHS[p.m] + " " + p.d + ", " + p.y; }
  function monthKey(iso) { var p = parts(iso); return p.y + "-" + p.m; }
  function monthLabel(iso) { var p = parts(iso); return MONTHS_LONG[p.m] + " " + p.y; }

  function todayLabel() {
    var t = new Date();
    return MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear();
  }

  function hex(status) {
    var check = status === "done"
      ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : "";
    return '<span class="hex s-' + status + '" aria-hidden="true">' + check + "</span>";
  }

  /* progress: 140/415 in roadmap.yaml -> a bar with the count and a 0-100% label (the build does the math) */
  function progressBar(e) {
    var p = e.progress;
    if (!p || e.status === "done") return "";
    var pct = Math.max(0, Math.min(100, +p.percent || 0));
    var count = p.done.toLocaleString() + " / " + p.total.toLocaleString() + (p.label ? " " + p.label : "");
    return (
      '<div class="rm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"' +
        ' aria-label="' + esc(e.title + ": " + count) + '">' +
        '<div class="rm-bar"><span style="width:' + pct + '%"></span></div>' +
        '<p class="rm-prog-label"><span>' + esc(count) + "</span><b>" + pct + "%</b></p>" +
      "</div>"
    );
  }

  function card(e, opts) {
    var when = e.date ? shortDate(e.date) : (e.when || "");
    var tag = e.tag ? '<span class="rm-tag t-' + esc(e.tag.replace(/[^a-z0-9-]/g, "")) + '">' + esc(e.tag) + "</span>" : "";
    var items = e.items && e.items.length
      ? "<ul>" + e.items.map(function (x) { return "<li>" + md(x) + "</li>"; }).join("") + "</ul>"
      : "";
    return (
      '<div class="rm-card">' +
        (opts.latest ? '<p class="rm-latest hand">Latest</p>' : "") +
        '<p class="rm-meta">' +
          // a bar says more than "Buzzing on it", so it takes the pill's place on entries that have one
          (e.progress && e.status === "doing" ? "" : '<span class="rm-status s-' + e.status + '">' + STATUS[e.status] + "</span>") + tag +
          (when ? '<span class="rm-when-inline">' + esc(when) + "</span>" : "") +
        "</p>" +
        "<h3>" + md(e.title) + "</h3>" +
        (e.summary ? '<p class="rm-sum">' + md(e.summary) + "</p>" : "") +
        progressBar(e) +
        items +
      "</div>"
    );
  }

  function stop(e, side, opts) {
    opts = opts || {};
    var when = e.date ? shortDate(e.date) : (e.when || "");
    return (
      "<article" + (opts.latest ? ' id="latest"' : "") + ' class="stop side-' + side + " st-" + e.status + (opts.latest ? " latest" : "") + '">' +
        '<div class="stop-when">' + (when ? '<time' + (e.date ? ' datetime="' + e.date + '"' : "") + ">" + esc(when) + "</time>" : "") + "</div>" +
        '<div class="stop-node">' + hex(e.status) + "</div>" +
        card(e, opts) +
      "</article>"
    );
  }

  /* Someday ideas: one compact block at the top instead of full cards */
  function somedayBlock(list) {
    return (
      '<section class="rm-block rm-someday" aria-labelledby="rm-someday-h">' +
        '<h2 id="rm-someday-h" class="hand">Someday, maybe</h2>' +
        "<ul>" + list.map(function (e) {
          var tag = e.tag ? ' <span class="rm-tag t-' + esc(e.tag.replace(/[^a-z0-9-]/g, "")) + '">' + esc(e.tag) + "</span>" : "";
          return (
            "<li>" + hex("later") +
              "<div><p class=\"rm-sd-title\"><b>" + md(e.title) + "</b>" + tag +
                (e.when ? ' <span class="rm-sd-when">' + esc(e.when) + "</span>" : "") + "</p>" +
                (e.summary ? '<p class="rm-sd-sum">' + md(e.summary) + "</p>" : "") +
              "</div>" +
            "</li>"
          );
        }).join("") + "</ul>" +
      "</section>"
    );
  }

  /* Older done entries: a folded list grouped by month; each line opens to its summary */
  function earlierBlock(list) {
    var out = [], month = null;
    list.forEach(function (e) {
      var mk = monthKey(e.date);
      if (mk !== month) {
        if (month !== null) out.push("</ul>");
        out.push('<h3 class="rm-eg">' + monthLabel(e.date) + "</h3><ul>");
        month = mk;
      }
      var p = parts(e.date);
      var head = '<time datetime="' + e.date + '">' + MONTHS[p.m] + " " + p.d + "</time><span>" + md(e.title) + "</span>";
      var body = (e.summary ? '<p class="rm-sum">' + md(e.summary) + "</p>" : "") +
        (e.items && e.items.length ? "<ul>" + e.items.map(function (x) { return "<li>" + md(x) + "</li>"; }).join("") + "</ul>" : "");
      out.push(body
        ? '<li><details><summary>' + head + "</summary><div class=\"rm-eb\">" + body + "</div></details></li>"
        : '<li><p class="rm-eline">' + head + "</p></li>");
    });
    if (month !== null) out.push("</ul>");
    return (
      '<details class="rm-block rm-earlier">' +
        '<summary><span class="hand">Earlier on the trail</span><span class="rm-ecount">' + list.length +
          (list.length === 1 ? " more thing done" : " more things done") + "</span></summary>" +
        '<div class="rm-elist">' + out.join("") + "</div>" +
      "</details>"
    );
  }

  function sign(text, cls, id) {
    return '<h2 class="rm-sign ' + (cls || "") + '"' + (id ? ' id="' + id + '"' : "") + "><span>" + text + "</span></h2>";
  }

  function render(data) {
    var html = [], n = 0;
    var up = data.upcoming || [], done = data.done || [];
    // Someday goes in its own block; Up next and Buzzing on it always stay on the trail
    var someday = up.filter(function (e) { return e.status === "later"; });
    var active = up.filter(function (e) { return e.status !== "later"; });
    // the newest TRAIL_DONE done entries get cards; the rest fold into "Earlier on the trail"
    var recent = done.slice(0, TRAIL_DONE), older = done.slice(TRAIL_DONE);

    if (someday.length) html.push(somedayBlock(someday));
    if (active.length) {
      html.push(sign("Coming up", "", "coming-up"));
      active.forEach(function (e) { html.push(stop(e, n++ % 2 ? "right" : "left")); });
    }

    html.push('<div class="rm-here"><span class="hand">You are here</span><span class="rm-here-date">' + todayLabel() + "</span></div>");

    if (done.length) {
      html.push(sign("Where we've been", "", "done"));
      var month = null;
      recent.forEach(function (e, i) {
        var mk = monthKey(e.date);
        if (i > 0 && mk !== month) html.push('<p class="rm-month"><span>' + monthLabel(e.date) + "</span></p>");
        month = mk;
        html.push(stop(e, i === 0 ? "center" : (n++ % 2 ? "right" : "left"), { latest: i === 0 }));
      });
      if (older.length) html.push(earlierBlock(older));
    }

    html.push('<div class="rm-start"><span class="hex s-done" aria-hidden="true"></span><span class="hand">The hive. It all started here.</span></div>');

    var trail = document.getElementById("trail");
    trail.querySelectorAll(".rm-loading, .stop, .rm-sign, .rm-here, .rm-month, .rm-start, .rm-block").forEach(function (el) { el.remove(); });
    trail.insertAdjacentHTML("beforeend", html.join(""));
    // opening or closing the folded list moves everything below it, so the bee re-measures her stops
    trail.querySelectorAll("details").forEach(function (d) {
      d.addEventListener("toggle", function () { window.dispatchEvent(new Event("resize")); });
    });

    var meta = document.getElementById("rm-meta");
    if (meta) meta.textContent = done.length + " things done · " + up.length + " on the way";
    // counted at build time from the mission files; drafts are never included in the live number
    var live = document.getElementById("rm-live"), st = data.stats;
    if (live && st) {
      live.textContent = st.live + " missions live · " + st.states_live + " of " + st.states_total + " states · " +
        st.drafts + " more being checked";
      live.hidden = false;
    }

    reveal();
    bee();
  }

  /* Cards drift in as the bee reaches them. */
  function reveal() {
    var stops = document.querySelectorAll(".stop");
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stops.forEach(function (s) { s.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    stops.forEach(function (s) { io.observe(s); });
  }


  /* The bee parks on a stop. Once the reading line (40% down the screen) passes halfway to the
     next stop, she flies there in a little arc. She faces the way you're scrolling. */
  function bee() {
    var trail = document.getElementById("trail");
    var pos = trail.querySelector(".bee-pos");
    var face = trail.querySelector(".bee-face");
    if (!pos || !face) return;
    var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var BEE_H = 58, LINE = 0.4;
    var spots = [], at = -1, y = 0, flight = null, lastScroll = window.scrollY, ticking = false;

    function measure() {
      var top = trail.getBoundingClientRect().top;
      spots = [20];   // the top of the trail, before the first stop
      trail.querySelectorAll(".stop-node .hex, .rm-here, .rm-start .hex").forEach(function (el) {
        var r = el.classList.contains("rm-here")
          ? { top: el.getBoundingClientRect().top, height: 16 }   // the "you are here" dot
          : el.getBoundingClientRect();
        spots.push(r.top - top + r.height / 2);
      });
      spots.sort(function (a, b) { return a - b; });
    }

    function place(newY) { y = newY; pos.style.transform = "translateY(" + (y - BEE_H / 2) + "px)"; }

    function currentY() {   // where she is right now, even mid-flight
      var m = getComputedStyle(pos).transform;
      if (!m || m === "none") return y;
      var v = m.match(/-?[\d.]+/g);
      return v ? parseFloat(v[v.length === 6 ? 5 : 13]) + BEE_H / 2 : y;
    }

    function flyTo(i, instant) {
      if (i === at) return;
      at = i;
      var to = spots[i];
      if (instant || still || !pos.animate) { if (flight) flight.cancel(); place(to); return; }
      var from = currentY();
      if (flight) flight.cancel();
      var side = from < to ? 26 : -26;   // swing out to one side, like she's following the curve
      var mid = (from + to) / 2;
      var dist = Math.abs(to - from);
      place(to);
      flight = pos.animate([
        { transform: "translate(0px," + (from - BEE_H / 2) + "px)" },
        { transform: "translate(" + side + "px," + (mid - BEE_H / 2) + "px)", offset: 0.5 },
        { transform: "translate(0px," + (to - BEE_H / 2) + "px)" }
      ], { duration: Math.min(900, 380 + dist * 0.6), easing: "cubic-bezier(.45,.05,.35,1)" });
      flight.onfinish = function () { flight = null; };
    }

    function nearest() {   // nearest stop to the reading line = "past halfway" rule
      var line = innerHeight * LINE - trail.getBoundingClientRect().top;
      var best = 0;
      for (var i = 1; i < spots.length; i++) {
        if (Math.abs(spots[i] - line) < Math.abs(spots[best] - line)) best = i;
      }
      return best;
    }

    function onScroll() {
      ticking = false;
      var now = window.scrollY, dy = now - lastScroll;
      if (Math.abs(dy) > 2) { face.classList.toggle("down", dy > 0); lastScroll = now; }
      flyTo(nearest());
    }

    function relayout() { measure(); var i = nearest(); at = -1; flyTo(i, true); }

    relayout();
    addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    addEventListener("resize", relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    addEventListener("load", relayout);
  }

  function fail() {
    var l = document.querySelector(".rm-loading");
    if (l) l.innerHTML = 'The trail went cold for a second. <a href="https://github.com/AmbleBee/amblebee-missions/blob/main/roadmap.yaml">See the roadmap on GitHub</a>.';
  }

  fetch("roadmap.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(fail);
})();
