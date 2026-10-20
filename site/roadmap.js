/* The bee trail: draws roadmap.json (built from roadmap.yaml) as a timeline.
   Nothing to edit here when the roadmap changes; edit roadmap.yaml instead. */
(function () {
  "use strict";

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
          '<span class="rm-status s-' + e.status + '">' + STATUS[e.status] + "</span>" + tag +
          (when ? '<span class="rm-when-inline">' + esc(when) + "</span>" : "") +
        "</p>" +
        "<h3>" + md(e.title) + "</h3>" +
        (e.summary ? '<p class="rm-sum">' + md(e.summary) + "</p>" : "") +
        items +
      "</div>"
    );
  }

  function stop(e, side, opts) {
    opts = opts || {};
    var when = e.date ? shortDate(e.date) : (e.when || "");
    return (
      '<article class="stop side-' + side + " st-" + e.status + (opts.latest ? " latest" : "") + '">' +
        '<div class="stop-when">' + (when ? '<time' + (e.date ? ' datetime="' + e.date + '"' : "") + ">" + esc(when) + "</time>" : "") + "</div>" +
        '<div class="stop-node">' + hex(e.status) + "</div>" +
        card(e, opts) +
      "</article>"
    );
  }

  function sign(text, cls, id) {
    return '<h2 class="rm-sign ' + (cls || "") + '"' + (id ? ' id="' + id + '"' : "") + "><span>" + text + "</span></h2>";
  }

  function render(data) {
    var html = [], n = 0;
    var up = data.upcoming || [], done = data.done || [];

    if (up.length) {
      html.push(sign("Coming up", "", "coming-up"));
      up.forEach(function (e) { html.push(stop(e, n++ % 2 ? "right" : "left")); });
    }

    html.push('<div class="rm-here"><span class="hand">You are here</span><span class="rm-here-date">' + todayLabel() + "</span></div>");

    if (done.length) {
      html.push(sign("Where we've been", "", "done"));
      var month = null;
      done.forEach(function (e, i) {
        var mk = monthKey(e.date);
        if (i > 0 && mk !== month) html.push('<p class="rm-month"><span>' + monthLabel(e.date) + "</span></p>");
        month = mk;
        html.push(stop(e, i === 0 ? "center" : (n++ % 2 ? "right" : "left"), { latest: i === 0 }));
      });
    }

    html.push('<div class="rm-start"><span class="hex s-done" aria-hidden="true"></span><span class="hand">The hive. It all started here.</span></div>');

    var trail = document.getElementById("trail");
    trail.querySelectorAll(".rm-loading, .stop, .rm-sign, .rm-here, .rm-month, .rm-start").forEach(function (el) { el.remove(); });
    trail.insertAdjacentHTML("beforeend", html.join(""));

    var meta = document.getElementById("rm-meta");
    if (meta) meta.textContent = done.length + " things done · " + up.length + " on the way";

    reveal();
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

  function fail() {
    var l = document.querySelector(".rm-loading");
    if (l) l.innerHTML = 'The trail went cold for a second. <a href="https://github.com/AmbleBee/amblebee-missions/blob/main/roadmap.yaml">See the roadmap on GitHub</a>.';
  }

  fetch("roadmap.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(fail);
})();
