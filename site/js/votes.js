/* Votes with friends (calendar-voting-PLAN.md, branch 3, §3): the vote builder (/vote/new/), the vote page and its
   results (/vote/#<id>) and Your votes (/me/votes/). The engine is amblebee-intake's app/polls.py; nothing about a
   vote is kept here except this browser's own list of the votes it started or voted in (for the dots and notices)
   and a random voter code, so one browser counts once without a profile.

   Playful look (decision 34): handwritten headings, tilted cards, honeycomb rank badges, a flip-clock countdown and
   confetti on the results. No tallies while voting is open, for anyone (decisions 6 and 7). */
(function () {
  "use strict";
  var API = "https://amblebee-intake.tail58116.ts.net";
  var VOTER = "amble.voter", MINE = "amble.votes", DRAFT = "amble.vote.draft";
  var P = window.AmbleProfile, D = window.AmbleDone, PL = window.AmblePlans;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var LENGTHS = [1, 6, 12, 24, 48];
  var ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];

  // ---- small helpers ----
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
  function add(e, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(e, k); }); return; }
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ } }
  function pad(n) { return ("0" + n).slice(-2); }
  function dayOf(s) { return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12); }
  function ymd(t) { return t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()); }
  function prettyDay(s) {
    if (!s) return "";
    var t = dayOf(s);
    return DAYS[t.getDay()] + ", " + MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear();
  }
  function shortDay(s) { var t = dayOf(s); return MONTHS[t.getMonth()] + " " + t.getDate(); }
  function voter() {
    var v = load(VOTER, "");
    if (!/^[A-Za-z0-9_-]{22}$/.test(v)) {
      var a = new Uint8Array(16); crypto.getRandomValues(a);
      v = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      save(VOTER, v);
    }
    return v;
  }
  // A vote's link: amblebee.com/vote/?v=<id>. The id is in the address itself, not after a #, because some apps
  // (Discord, for one) drop everything after the # when they open a link. Older #<id> links keep working.
  var ID_RE = /^[A-Za-z0-9_-]{16}$/;
  function voteUrl(pub) { return location.origin + "/vote/?v=" + pub; }
  function voteId() {
    var h = location.hash.slice(1);
    if (ID_RE.test(h)) return h;
    var q = new URLSearchParams(location.search).get("v") || "";
    return ID_RE.test(q) ? q : "";
  }
  function has() { return !!(P && P.has() && !P.state().pinNeeded); }
  function api(path, method, body) {
    var h = Object.assign({}, P && has() ? P.headers() : {}, { "X-Amble-Voter": voter() });
    if (method === "POST") h["Content-Type"] = "application/json";
    return fetch(API + path, { method: method || "GET", headers: h, body: method === "POST" ? JSON.stringify(body || {}) : undefined,
                               cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); },
            function () { return { status: 0, body: { error: "We couldn't reach our server just now. Please try again in a little while." } }; });
  }
  function problem(r) { return (r.body && (r.body.error || (r.body.errors && Object.values(r.body.errors)[0]))) || "Something went wrong."; }

  // this browser's votes: { pub, name, for_date, closes_at, role: "creator" | "voter", seen: true once its end was looked at }
  function mine() { return load(MINE, []).filter(function (x) { return x && x.pub; }); }
  function remember(v, role) {
    var list = mine(), x = list.find(function (y) { return y.pub === v.pub; }) || { pub: v.pub, role: role };
    if (role === "creator") x.role = "creator";
    x.name = v.name; x.for_date = v.for_date; x.closes_at = v.closes_at; x.status = v.status;
    if (v.status === "finished" || v.status === "cancelled") x.ended = true;
    list = list.filter(function (y) { return y.pub !== v.pub; });
    list.unshift(x);
    save(MINE, list.slice(0, 30));
    try { window.dispatchEvent(new CustomEvent("amble:votes")); } catch (e) { /* old browser */ }
    return x;
  }
  function markSeen(pub) {
    var list = mine(), x = list.find(function (y) { return y.pub === pub; });
    if (x && !x.seen) { x.seen = true; save(MINE, list); try { window.dispatchEvent(new CustomEvent("amble:votes")); } catch (e) { /* fine */ } }
  }
  function forget(pub) { save(MINE, mine().filter(function (y) { return y.pub !== pub; })); }

  var catalog = null;
  function missions() {
    if (!catalog) catalog = fetch("/catalog.json", { cache: "force-cache" }).then(function (r) { return r.json(); })
      .then(function (c) { var by = {}; (c.missions || []).forEach(function (m) { by[m.full_id] = m; }); return by; }, function () { return {}; });
    return catalog;
  }
  function honeycomb(text, cls) {
    return el("span", { class: "hex-badge " + (cls || "") }, el("span", { text: text }));
  }

  // ================================= the builder: /vote/new/ =================================
  function builder(app) {
    var d = load(DRAFT, null) || { name: "", for_date: "", missions: [], style: "pick", tie_rule: "coin", runoff_hours: 1,
                                   names_public: true, profiles_only: false, hours: 24 };
    var add1 = /^#add=([a-z0-9-]+\/[a-z0-9-]+)$/.exec(location.hash);
    if (add1 && d.missions.indexOf(add1[1]) < 0 && d.missions.length < 10) d.missions.push(add1[1]);
    if (add1) history.replaceState(null, "", location.pathname);
    save(DRAFT, d);
    var free = null, cap = 48;

    function draw(by) {
      if (!has()) {
        app.replaceChildren(el("div", { class: "vote-card tilt-l" },
          el("h2", { class: "hand-title", text: "Start a vote" }),
          el("p", {}, "Pick a few missions, send your friends a link, and everyone votes. To start one you need a free profile (your friends don't)."),
          P && P.state().pinNeeded ? el("p", {}, el("a", { href: "/me/settings/#profile", text: "Enter your PIN" }), " to use your profile on this device.") :
            el("button", { type: "button", class: "btn primary vote-start-profile", text: "Start a free profile",
                           onclick: function () { P.offer(false, { done: function () { setTimeout(function () { draw(by); refreshHours(); }, 0); } }); } })));
        return;
      }
      var err = el("p", { class: "form-status bad", role: "alert" });
      var name = el("input", { id: "v-name", type: "text", maxlength: "60", placeholder: "4th of July plans", value: d.name });
      var day = el("input", { id: "v-day", type: "date", min: ymd(new Date()), value: d.for_date });
      name.addEventListener("input", function () { d.name = name.value; save(DRAFT, d); });
      day.addEventListener("change", function () { d.for_date = day.value; save(DRAFT, d); draw(by); document.getElementById("v-day").focus(); });

      var list = el("ul", { class: "vote-picks" });
      d.missions.forEach(function (id, i) {
        var m = by[id];
        if (!m) return;
        var warn = [];
        if (PL && PL.outOfSeason(m, ymd(new Date()))) warn.push("Out of season right now");
        if (PL && d.for_date && PL.outOfSeason(m, d.for_date)) warn.push("Out of season on " + shortDay(d.for_date) + ", " + d.for_date.slice(0, 4));
        list.append(el("li", { class: "vote-pick tilt-" + (i % 2 ? "r" : "l") },
          el("span", { class: "vote-pick-name" }, el("b", { text: m.name }), m.place && m.place.name ? el("small", { text: m.place.name }) : null),
          warn.length ? el("p", { class: "vote-season" }, warn.join(" · ")) : null,
          el("button", { type: "button", class: "linkish vote-remove", "aria-label": "Remove " + m.name, text: "Remove",
                         onclick: function () { d.missions.splice(i, 1); save(DRAFT, d); draw(by); } })));
      });
      var search = el("input", { id: "v-search", type: "search", placeholder: "Search missions by name", autocomplete: "off" });
      var found = el("ul", { class: "vote-found" });
      search.addEventListener("input", function () {
        var q = search.value.trim().toLowerCase();
        found.replaceChildren();
        if (q.length < 2) return;
        Object.keys(by).filter(function (k) { return d.missions.indexOf(k) < 0 && by[k].name.toLowerCase().indexOf(q) >= 0; }).slice(0, 8)
          .forEach(function (k) {
            found.append(el("li", {}, el("button", { type: "button", class: "btn small vote-add", text: "Add " + by[k].name,
              disabled: d.missions.length >= 10, onclick: function () { d.missions.push(k); save(DRAFT, d); draw(by); var s = document.getElementById("v-search"); if (s) s.focus(); } })));
          });
      });

      function radio(group, value, label, checked, extra) {
        var r = el("input", { type: "radio", name: group, value: value, id: "v-" + group + "-" + value, checked: checked, disabled: extra && extra.disabled });
        r.addEventListener("change", function () { d[group] = isNaN(+value) ? value : +value; save(DRAFT, d); if (group === "tie_rule") draw(by); });
        return el("label", { class: "check", for: r.id }, r, " " + label);
      }
      function box(key, label, hintOn, hintOff) {
        var c = el("input", { type: "checkbox", id: "v-" + key, checked: !!d[key] });
        var h = el("p", { class: "hint", text: d[key] ? hintOn : hintOff });
        c.addEventListener("change", function () { d[key] = c.checked; save(DRAFT, d); h.textContent = c.checked ? hintOn : hintOff; });
        return [el("label", { class: "check", for: c.id }, c, " " + label), h];
      }
      var lengths = el("div", { class: "vote-lengths", role: "radiogroup", "aria-label": "How long voting stays open" },
        LENGTHS.map(function (h) { return radio("hours", String(h), h + (h === 1 ? " hour" : " hours"), d.hours === h, { disabled: free != null && h > free }); }));
      var start = el("button", { type: "submit", class: "btn primary vote-go", text: "Start the vote" });
      var form = el("form", { class: "vote-builder", novalidate: true },
        el("div", { class: "vote-card tilt-l" },
          el("label", { for: "v-name", class: "hand-label", text: "Name your vote" }), name,
          el("label", { for: "v-day", class: "hand-label", text: "When's it for?" }), day),
        el("div", { class: "vote-card tilt-r" },
          el("h2", { class: "hand-title" }, "The missions ", el("small", { text: d.missions.length + " of 10" })),
          d.missions.length ? list : el("p", { class: "hint", text: "Add at least 2. Open any mission and tap Start a vote, or search here." }),
          el("label", { for: "v-search", class: "sr", text: "Search missions by name" }), search, found),
        el("div", { class: "vote-card" },
          el("fieldset", {}, el("legend", { text: "How do people vote?" }),
            radio("style", "pick", "One pick per person", d.style === "pick"),
            radio("style", "ranked", "Ranked: a favorite, then as many others as they like", d.style === "ranked"),
            el("p", { class: "hint" }, el("a", { href: "/faq/#ranked", text: "How ranked voting works" }))),
          el("fieldset", {}, el("legend", { text: "If it's a tie for first" }),
            radio("tie_rule", "coin", "Flip a coin", d.tie_rule === "coin"),
            radio("tie_rule", "revote", "Re-vote on the tied ones", d.tie_rule === "revote"),
            d.tie_rule === "revote" ? el("label", { class: "check" }, "Re-vote for ",
              (function () {
                var s = el("select", { id: "v-runoff" }, [1, 2, 6, 12].map(function (h) { return el("option", { value: h, selected: d.runoff_hours === h }, h + (h === 1 ? " hour" : " hours")); }));
                s.addEventListener("change", function () { d.runoff_hours = +s.value; save(DRAFT, d); });
                return s;
              })()) : null),
          box("names_public", "Show voters' names to everyone", "Everyone sees who voted (never who picked what).", "Only you'll see who voted."),
          box("profiles_only", "Only people with a profile can vote", "Friends will need a free profile. Each person counts once.", "Anyone with the link can vote.")),
        el("div", { class: "vote-card tilt-l" },
          el("fieldset", {}, el("legend", { text: "How long can people vote?" }), lengths,
            el("p", { class: "hint vote-hours", text: free == null ? "" : free + " of your " + cap + " voting hours are free. Hours free up as your other votes run." }))),
        err, start, el("p", { class: "hint", text: "Once it starts, the missions can't change." }));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        err.textContent = "";
        var body = { name: d.name.trim(), for_date: d.for_date, style: d.style, hours: d.hours, tie_rule: d.tie_rule, runoff_hours: d.runoff_hours,
                     names_public: !!d.names_public, profiles_only: !!d.profiles_only,
                     missions: d.missions.map(function (id) { var m = by[id] || {}; return { id: id, name: m.name, pack: m.pack, season: m.season,
                                                                                               place: m.place && m.place.name }; }) };
        if (!body.name) { err.textContent = "Give your vote a name."; name.focus(); return; }
        if (!body.for_date) { err.textContent = "Pick the day it's for."; day.focus(); return; }
        if (body.missions.length < 2) { err.textContent = "Pick at least 2 missions."; search.focus(); return; }
        start.disabled = true; start.textContent = "Starting…";
        api("/polls", "POST", body).then(function (r) {
          if (r.status !== 201) { start.disabled = false; start.textContent = "Start the vote"; err.textContent = problem(r); if (r.body && r.body.free != null) { free = r.body.free; } return; }
          save(DRAFT, null);
          remember(r.body, "creator");
          shared(app, r.body);
        });
      });
      app.replaceChildren(form);
    }
    function refreshHours() {
      if (!has()) return;
      api("/polls/mine").then(function (r) {
        if (r.status === 200 && r.body.hours) { free = r.body.hours.free; cap = r.body.hours.cap;
          if (d.hours > free) { var fit = LENGTHS.filter(function (h) { return h <= free; }); d.hours = fit.length ? fit[fit.length - 1] : d.hours; }
          missions().then(draw); }
      });
    }
    missions().then(draw);
    refreshHours();
  }

  // after starting: the link, Copy, Share and a QR code
  function shared(app, v) {
    var url = voteUrl(v.pub);
    var note = el("span", { class: "copy-note", role: "status" });
    var qr = null;
    try { qr = window.AmbleQR ? window.AmbleQR.svg(url, { label: "QR code for the vote link" }) : null; } catch (e) { qr = null; }
    app.replaceChildren(el("div", { class: "vote-card vote-shared tilt-l" },
      el("h2", { class: "hand-title", text: "It's on! Send your crew the link" }),
      el("p", {}, el("b", { text: v.name }), " · " + prettyDay(v.for_date)),
      el("div", { class: "copy-row" }, el("input", { class: "link-box", id: "vote-link", readonly: true, value: url, "aria-label": "The vote's link" }),
        el("button", { type: "button", class: "btn small", text: "Copy", onclick: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { note.textContent = "Copied."; },
            function () { note.textContent = "Select it and copy."; }); } }), note),
      navigator.share ? el("button", { type: "button", class: "btn small", text: "Share", onclick: function () {
        navigator.share({ title: v.name, text: "Help pick the plan: " + v.name, url: url }).catch(function () { /* closed */ }); } }) : null,
      qr ? el("div", { class: "vote-qr" }, qr) : null,
      el("p", {}, el("a", { class: "btn primary", href: "/vote/?v=" + v.pub, text: "Open the vote and cast yours" }))));
    var b = document.getElementById("vote-link"); if (b) b.select();
  }

  // ================================= the vote page: /vote/#<id> =================================
  var tick = null;
  function votePage(app) {
    var pub = voteId();
    if (!pub) {
      app.replaceChildren(el("div", { class: "vote-card" }, el("h2", { class: "hand-title", text: "No vote here" }),
        el("p", {}, "This link is missing its vote. Check that the whole link was copied, or ", el("a", { href: "/vote/new/", text: "start your own vote" }), ".")));
      return;
    }
    function fetchIt() {
      api("/polls/" + pub).then(function (r) {
        if (r.status === 404) {
          forget(pub);
          app.replaceChildren(el("div", { class: "vote-card" }, el("h2", { class: "hand-title", text: "This vote has been removed" }),
            el("p", {}, "Votes go 30 days after they end, or when the person who started it deletes it. ", el("a", { href: "/vote/new/", text: "Start a new vote" }), ".")));
          return;
        }
        if (r.status !== 200) { app.replaceChildren(el("p", { class: "form-status bad", text: problem(r) })); return; }
        var v = r.body;
        if (v.you.creator || v.you.voted || mine().some(function (x) { return x.pub === v.pub; })) remember(v, v.you.creator ? "creator" : "voter");
        missions().then(function (by) { render(app, v, by, fetchIt); });
      });
    }
    fetchIt();
  }

  function countdown(v, onZero) {
    var box = el("div", { class: "flip-clock", role: "timer", "aria-live": "off" });
    var end = new Date(v.closes_at).getTime(), skew = Date.now() - new Date(v.now).getTime();
    function paint() {
      var left = Math.max(0, Math.floor((end - (Date.now() - skew)) / 1000));
      var h = Math.floor(left / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
      box.replaceChildren.apply(box, [el("span", { class: "sr", text: "Voting closes in " + h + " hours " + m + " minutes " + s + " seconds" })].concat(
        [[h, "hours"], [m, "minutes"], [s, "seconds"]].map(function (p) {
          return el("span", { class: "flip", "aria-hidden": "true" }, el("b", { text: pad(p[0]) }), el("small", { text: p[1] }));
        })));
      if (left <= 0) { clearInterval(tick); tick = null; setTimeout(onZero, 1500); }   // the server decides: ask again
    }
    clearInterval(tick);
    paint();
    tick = setInterval(paint, 1000);
    return box;
  }

  function details(m, o) {
    if (!m) return el("p", { class: "hint", text: o.place || "" });
    return el("div", { class: "vote-more" },
      m.short ? el("p", { text: m.short }) : null,
      m.description ? el("p", { text: m.description }) : null,
      m.place && m.place.name ? el("p", {}, el("b", { text: "Where: " }), m.place.name) : null,
      el("p", {}, el("a", { href: "/missions/" + encodeURIComponent(m.id) + "/", target: "_blank", rel: "noopener", text: "Open the full mission page" })));
  }

  function render(app, v, by, again) {
    var status = el("p", { class: "form-status", role: "status" });
    function say(t, bad) { status.textContent = t; status.classList.toggle("bad", !!bad); }
    var head = el("header", { class: "vote-head" },
      el("p", { class: "hand-title vote-invite", text: v.status === "runoff" ? "It's a tie! Vote again" :
        v.status === "finished" ? "And the winner is…" : v.status === "cancelled" ? "This vote was cancelled" : "You're invited to vote!" }),
      el("h1", { class: "vote-name", text: v.name }),
      el("p", { class: "vote-date" }, el("b", { text: prettyDay(v.for_date) }), v.started_by ? " · Started by " + v.started_by : ""),
      v.profiles_only ? el("p", { class: "chip vote-signed", text: "Signed-in votes only" }) : null);
    var parts = [head];

    if (v.status === "open" || v.status === "runoff") {
      parts.push(el("div", { class: "vote-clock" }, el("p", { class: "hint", text: "Voting closes in" }), countdown(v, again)));
      var count = v.status === "runoff" ? v.runoff.voters : v.voters;
      var initials = (v.names || []).filter(function (n) { return !n.hidden; }).slice(0, 6).map(function (n) { return el("span", { class: "initial", text: n.name.slice(0, 1).toUpperCase(), title: n.name }); });
      parts.push(el("p", { class: "vote-count" }, initials.length ? el("span", { class: "initials", "aria-hidden": "true" }, initials) : null,
        el("b", { text: count + (count === 1 ? " person has voted" : " people have voted") })));
      parts.push(ballotForm(v, by, say, again));
      if (v.you.creator) parts.push(creatorBar(v, say, again));
    } else if (v.status === "finished") {
      markSeen(v.pub);
      parts.push(results(v, by));
    } else if (v.status === "cancelled") {
      markSeen(v.pub);
      parts.push(el("p", {}, "The person who started it cancelled it, so there are no results. ", el("a", { href: "/vote/new/", text: "Start a new vote" }), "."));
    }
    if (v.status === "open" || v.status === "runoff") parts.push(shareCard(v));
    parts.push(votedSoFar(v, say, again), status);
    if (v.status === "finished") parts.push(el("p", { class: "hint", text: "These results stay at this link for 30 days." }));
    app.replaceChildren.apply(app, parts);
  }

  function ballotForm(v, by, say, again) {
    var runoff = v.status === "runoff";
    var opts = runoff ? v.options.filter(function (o) { return v.runoff.options.indexOf(o.id) >= 0; }) : v.options;
    var ranked = v.style === "ranked" && !runoff;
    if (v.profiles_only && !v.you.signed_in) {
      return el("div", { class: "vote-card tilt-l vote-signin" },
        el("p", {}, el("b", { text: (v.started_by || "The person who started it") + " asked for signed-in votes, so each person counts once." })),
        el("div", { class: "backup-row" },
          el("button", { type: "button", class: "btn primary", text: "Start a free profile", onclick: function () { P.offer(false, { done: function () { setTimeout(again, 0); } }); } }),
          el("a", { class: "btn small", href: "/me/settings/#profile", text: "Sign in" })),
        el("ul", { class: "vote-options" }, opts.map(function (o) { return optionCard(o, by, null, null, ranked); })));
    }
    var pick = (v.you.voted && v.you.choice) ? v.you.choice.slice() : [];
    var list = el("ul", { class: "vote-options" });
    function paint() {
      list.replaceChildren.apply(list, opts.map(function (o, i) {
        var at = pick.indexOf(o.id);
        return optionCard(o, by, at, function () {
          if (ranked) { if (at >= 0) pick.splice(at, 1); else pick.push(o.id); }
          else pick = at >= 0 ? [] : [o.id];
          paint();
        }, ranked, i);
      }));
    }
    paint();
    var shown = P && has() ? P.displayName() : "";
    var nameIn = el("input", { id: "vote-name", type: "text", maxlength: "30", autocomplete: "nickname", value: v.you.name || shown || "" });
    var cast = el("button", { type: "submit", class: "btn primary vote-cast", text: v.you.voted ? "Change my vote" : "Cast my vote!" });
    var form = el("form", { class: "vote-ballot", novalidate: true },
      el("p", { class: "hand-label", text: ranked ? "Tap your favorite first! Then keep tapping to rank the rest, if you like." : "Tap the one you'd pick." }),
      list,
      el("div", { class: "done-field" },
        el("label", { for: "vote-name" }, "Sign your name ", el("span", { class: "opt", text: "(optional)" })), nameIn,
        shown && !v.you.name ? el("p", { class: "hint", text: "From your profile. Change or clear it for this vote." }) :
          has() && !shown ? el("p", { class: "hint", text: "Set a display name in your profile to fill this in next time." }) : null),
      cast,
      v.you.voted ? el("p", { class: "vote-in", text: "Your vote is in. You can change it until voting closes." }) : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!pick.length) { say(ranked ? "Tap your favorite first." : "Tap the one you'd pick.", true); return; }
      cast.disabled = true;
      api("/polls/" + v.pub + "/ballot", "POST", { choice: pick, name: nameIn.value.trim() }).then(function (r) {
        cast.disabled = false;
        if (r.status !== 200) { say(problem(r), true); return; }
        remember(r.body, r.body.you.creator ? "creator" : "voter");
        say(has() ? "Your vote is in. We'll ask if you went after " + shortDay(r.body.for_date) + "." : "Your vote is in.");
        render(document.querySelector(".vote-app"), r.body, by, again);
        var s = document.querySelector(".vote-app .form-status");
        if (s) s.textContent = has() ? "Your vote is in. We'll ask if you went after " + shortDay(r.body.for_date) + "." : "Your vote is in.";
      });
    });
    return form;
  }

  function optionCard(o, by, at, onTap, ranked, i) {
    var m = by[o.mission];
    var more = details(m, o);
    more.hidden = true;
    var expand = el("button", { type: "button", class: "vote-expand", "aria-expanded": "false", "aria-label": "More about " + o.name, text: "⌄",
                                onclick: function () { more.hidden = !more.hidden; expand.setAttribute("aria-expanded", String(!more.hidden)); expand.classList.toggle("open", !more.hidden); } });
    var badge = at == null ? null : at >= 0 ? honeycomb(ranked ? ORD[at] : "✓", "on") : honeycomb(ranked ? "tap" : "", "off");
    var main = onTap ? el("button", { type: "button", class: "vote-option-tap", "aria-pressed": String(at >= 0), onclick: onTap },
      badge, el("span", { class: "vote-option-name" }, el("b", { text: o.name }), o.place ? el("small", { text: o.place }) : null))
      : el("div", { class: "vote-option-tap" }, el("span", { class: "vote-option-name" }, el("b", { text: o.name })));
    return el("li", { class: "vote-option tilt-" + ((i || 0) % 2 ? "r" : "l") + (at >= 0 ? " is-picked" : "") }, main, expand, more);
  }

  // Share this vote: the link, Copy, Share and a QR code, for anyone who needs it after it starts. The person who
  // started it also gets "Open on my phone": a QR code that signs their phone in and opens this vote.
  function qrOf(url, label) {
    try { return window.AmbleQR ? window.AmbleQR.svg(url, { label: label }) : null; } catch (e) { return null; }
  }
  function copyRow(id, url, label) {
    var note = el("span", { class: "copy-note", role: "status" });
    return el("div", { class: "copy-row" }, el("input", { class: "link-box", id: id, readonly: true, value: url, "aria-label": label }),
      el("button", { type: "button", class: "btn small", text: "Copy", onclick: function () {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { note.textContent = "Copied."; },
          function () { var i = document.getElementById(id); if (i) i.select(); note.textContent = "Select it and copy."; }); } }), note);
  }
  function shareCard(v) {
    var url = voteUrl(v.pub);
    var qrBox = el("div", { class: "vote-qr", hidden: true });
    var card = el("section", { class: "vote-card vote-share tilt-r", "aria-labelledby": "share-title" },
      el("h2", { id: "share-title", class: "hand-title", text: "Share this vote" }),
      copyRow("vote-share-link", url, "The vote's link"),
      el("div", { class: "backup-row" },
        navigator.share ? el("button", { type: "button", class: "btn small", text: "Share", onclick: function () {
          navigator.share({ title: v.name, text: "Help pick the plan: " + v.name, url: url }).catch(function () { /* closed */ }); } }) : null,
        el("button", { type: "button", class: "btn small vote-qr-show", text: "Show a QR code", onclick: function (e) {
          if (!qrBox.firstChild) { var q = qrOf(url, "QR code for the vote link"); if (q) qrBox.append(q, el("p", { class: "hint", text: "Friends can scan this to open the vote." })); }
          qrBox.hidden = !qrBox.hidden; e.currentTarget.textContent = qrBox.hidden ? "Show a QR code" : "Hide the QR code"; } })),
      qrBox);
    if (v.you.creator && P && P.linkTo) {
      var mine = P.linkTo("/vote/?v=" + v.pub);
      var phone = el("div", { class: "vote-phone", hidden: true },
        el("p", {}, el("b", { text: "Scan this with your own phone." }),
          " It signs your phone in to your profile and opens this vote, so you can share it from there. Anyone who scans it can open your profile, so don't share a photo of it."),
        qrOf(mine, "QR code that opens this vote on your phone, signed in"),
        copyRow("vote-phone-link", mine, "A link that opens this vote on another device, signed in to your profile"));
      card.append(el("button", { type: "button", class: "btn small vote-phone-show", text: "Open on my phone", onclick: function (e) {
        phone.hidden = !phone.hidden; e.currentTarget.textContent = phone.hidden ? "Open on my phone" : "Hide"; } }), phone);
    }
    return card;
  }

  function creatorBar(v, say, again) {
    function act(path, body, ok) {
      return api("/polls/" + v.pub + "/" + path, "POST", body).then(function (r) {
        if (r.status !== 200) { say(problem(r), true); return; }
        say(ok); again();
      });
    }
    var cancel = el("button", { type: "button", class: "linkish vote-cancel", text: "Cancel the vote", onclick: function () {
      if (!cancel.dataset.sure) { cancel.dataset.sure = "1"; cancel.textContent = "Cancel it? There'll be no results"; return; }
      act("cancel", {}, "Cancelled.");
    } });
    var free = v.hours ? v.hours.free : 0;
    return el("div", { class: "vote-card vote-creator" },
      el("h2", { class: "hand-title", text: "Your vote" }),
      el("div", { class: "backup-row" }, "Add time:",
        [1, 6, 12].map(function (h) { return el("button", { type: "button", class: "btn small vote-extend", disabled: h > free, text: "+" + h + (h === 1 ? " hour" : " hours"),
                                                           onclick: function () { act("extend", { hours: h }, "Added " + h + (h === 1 ? " hour." : " hours.")); } }); })),
      el("div", { class: "backup-row" },
        el("button", { type: "button", class: "btn small vote-finish", text: "Finish voting now", onclick: function () { act("finish", {}, "Voting's finished."); } }),
        cancel),
      el("p", { class: "hint", text: "You vote too, and you can't see any tallies until it ends either." }));
  }

  function votedSoFar(v, say, again) {
    var names = v.names || [];
    var count = v.voters;
    var box = el("section", { class: "vote-card vote-voted", "aria-labelledby": "voted-title" },
      el("h2", { id: "voted-title", class: "hand-title", text: v.status === "finished" ? "Voted" : "Voted so far" }));
    if (v.you.creator) {
      // one line, like everyone else sees, so a long list never takes over the page; tap a name to hide or show it
      var line = el("p", { class: "voted-line" });
      names.forEach(function (n, i) {
        if (i) line.append(", ");
        line.append(el("button", { type: "button", class: "voted-name" + (n.hidden ? " is-hidden" : ""), "aria-pressed": String(!!n.hidden),
          title: n.hidden ? "Hidden from others. Tap to show it again." : "Tap to hide this name from others", text: n.name,
          onclick: function (e) {
            e.currentTarget.disabled = true;
            api("/polls/" + v.pub + "/names/" + n.id + "/" + (n.hidden ? "show" : "hide"), "POST", {}).then(function (r) {
              if (r.status !== 200) { say(problem(r), true); e.currentTarget.disabled = false; } else again(); });
          } }));
      });
      var unnamed = count - names.length;
      if (!names.length) line.append(count + (count === 1 ? " person" : " people"));
      else if (unnamed > 0) line.append(", plus " + unnamed + (unnamed === 1 ? " other person" : " other people"));
      box.append(line, el("p", { class: "hint", text: v.names_public
        ? "Tap a name to hide it from others (it greys out here). Their vote still counts."
        : "Only you see these names." }));
      return box;
    }
    var shown = names.map(function (n) { return n.name; });
    var others = count - shown.length;
    var text = !shown.length ? count + (count === 1 ? " person" : " people")
      : shown.join(", ") + (others > 0 ? ", plus " + others + (others === 1 ? " other person" : " other people") : "");
    box.append(el("p", { class: "voted-line", text: text }));
    return box;
  }

  function results(v, by) {
    var r = v.result || {}, scores = (r.runoff ? r.runoff.scores : r.scores) || [], all = r.scores || [];
    var name = function (id) { var o = v.options.find(function (x) { return x.id === id; }); return o ? o.name : ""; };
    var out = el("section", { class: "vote-results" });
    if (!r.voters || !r.winner) { out.append(el("p", { class: "vote-empty", text: "No one voted." })); return out; }
    var top = all.slice().sort(function (a, b) { return a.option === r.winner ? -1 : b.option === r.winner ? 1 : 0; }).slice(0, Math.min(3, all.length));
    var spots = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
    out.append(el("div", { class: "confetti", "aria-hidden": "true" }),
      el("ol", { class: "podium" + (top.length === 2 ? " two" : "") }, spots.map(function (x) {
        var place = x === top[0] ? 1 : x === top[1] ? 2 : 3;
        return el("li", { class: "step step-" + place },
          place === 1 ? el("span", { class: "crown", "aria-hidden": "true", text: "♛" }) : null,
          honeycomb(ORD[place - 1], "on"), el("b", { text: name(x.option) }),
          el("small", { text: x.points + (v.style === "ranked" && !r.runoff ? (x.points === 1 ? " point" : " points") : (x.points === 1 ? " vote" : " votes")) }));
      })));
    if (v.coin_flip) {
      var tied = all.filter(function (x) { return x.place === 1 && x.option !== r.winner; }).map(function (x) { return name(x.option); });
      out.append(el("p", { class: "vote-coin", text: tied.length > 1 ? "Tied with " + tied.join(" and ") + ": won the draw." : "Tied with " + tied[0] + ": won the coin flip." }));
    }
    if (r.runoff) out.append(el("p", { class: "hint", text: "Decided by a re-vote on the tied missions." }));
    var rest = all.filter(function (x) { return top.indexOf(x) < 0; });
    if (rest.length) out.append(el("h3", { text: "Also in the running" }),
      el("ul", { class: "vote-rest" }, rest.map(function (x) { return el("li", {}, name(x.option) + " · " + x.points + (v.style === "ranked" ? " points" : " votes")); })));
    var win = v.options.find(function (o) { return o.id === r.winner; });
    var m = win && by[win.mission];
    var card = el("div", { class: "vote-card vote-plan tilt-r" }, el("p", { class: "hand-title", text: "It's a plan!" }), el("b", { text: win ? win.name : "" }));
    var acts = el("div", { class: "backup-row" });
    if (m && PL) acts.append(el("button", { type: "button", class: "btn primary small vote-calendar", text: "Add to calendar", onclick: function (e) {
      PL.open(m, { day: v.for_date, from: e.currentTarget, vote_id: v.pub, vote_name: v.name.slice(0, 60) }); } }));
    if (win) acts.append(el("a", { class: "btn small", href: "/missions/" + encodeURIComponent(win.slug) + "/", text: "Open the mission" }));
    card.append(acts);
    // "Did you go?" once the day has passed, only for people who were part of it (decisions 35 and 41)
    var part = v.you.creator || v.you.voted || mine().some(function (x) { return x.pub === v.pub; });
    if (part && win && D) {
      var plan = (D.plans() || []).find(function (x) { return x.vote_id === v.pub; });
      if (!plan && !has() && !(mine().find(function (x) { return x.pub === v.pub; }) || {}).planned) {
        // without a profile, the winner becomes a plan on this device (signed-in voters get theirs from the server)
        plan = D.addPlan({ mission: win.mission, slug: win.slug, name: win.name }, v.for_date, null, { source: "vote", vote_id: v.pub, vote_name: v.name.slice(0, 60) });
        var list = mine(), x = list.find(function (y) { return y.pub === v.pub; }); if (x) { x.planned = true; save(MINE, list); }
      }
      if (plan && plan.day < ymd(new Date())) {
        card.append(el("div", { class: "vote-didyougo" }, el("p", {}, el("b", { text: "Did you go?" })),
          el("div", { class: "backup-row" },
            el("a", { class: "btn primary small", href: "/missions/" + encodeURIComponent(win.slug) + "/#did-you-go", text: "Mark it done" }),
            el("button", { type: "button", class: "btn small", text: "We didn't go", onclick: function (e) {
              D.removePlan(plan.id); e.currentTarget.parentNode.parentNode.replaceChildren(el("p", { class: "hint", text: "No problem. It's off your plans." })); } }))));
      }
    }
    out.append(card);
    return out;
  }

  // ================================= Your votes: /me/votes/ =================================
  function yourVotes(app) {
    if (!has()) {
      var here = mine();
      app.replaceChildren(el("p", {}, "Votes you start need a free profile. ", el("button", { type: "button", class: "btn small primary", text: "Start a free profile",
        onclick: function () { P.offer(false, { done: function () { setTimeout(function () { yourVotes(app); }, 0); } }); } })),
        here.length ? joined(here) : el("p", { class: "hint", text: "Votes you join on this device show up here too." }));
      return;
    }
    app.replaceChildren(el("p", { class: "hint", text: "Loading your votes…" }));
    api("/polls/mine").then(function (r) {
      if (r.status !== 200) { app.replaceChildren(el("p", { class: "form-status bad", text: problem(r) })); return; }
      var votes = r.body.votes || [], h = r.body.hours || { used: 0, cap: 48 };
      votes.forEach(function (v) { remember(v, "creator"); if (v.status === "finished" || v.status === "cancelled") markSeen(v.pub); });
      var ul = el("ul", { class: "vote-list" }, votes.map(function (v) {
        var state = v.status === "finished" ? "Finished" : v.status === "cancelled" ? "Cancelled" : v.status === "runoff" ? "Re-vote running" : "Voting until " + new Date(v.closes_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
        var del = el("button", { type: "button", class: "linkish", text: "Delete", onclick: function () {
          if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "Delete for good? The link stops working"; return; }
          api("/polls/" + v.pub + "/delete", "POST", {}).then(function () { forget(v.pub); yourVotes(app); });
        } });
        return el("li", { class: "vote-row" }, el("a", { href: "/vote/?v=" + v.pub }, el("b", { text: v.name })),
          el("small", { text: prettyDay(v.for_date) + " · " + state + " · " + v.voters + (v.voters === 1 ? " voter" : " voters") }), del);
      }));
      var others = mine().filter(function (x) { return x.role !== "creator"; });
      app.replaceChildren(el("p", { class: "vote-hours-line" }, el("b", { text: h.used + " of " + h.cap }), " voting hours in use. Hours free up as your votes run."),
        el("p", {}, el("a", { class: "btn primary", href: "/vote/new/", text: "Start a vote" })),
        votes.length ? ul : el("p", { class: "plan-empty", text: "No votes yet. Open any mission and tap Start a vote." }),
        others.length ? joined(others) : "");
    });
  }
  function joined(list) {
    list.forEach(function (x) { if (x.ended) markSeen(x.pub); });
    return el("section", {}, el("h2", { text: "Votes you joined" }),
      el("ul", { class: "vote-list" }, list.map(function (x) {
        return el("li", { class: "vote-row" }, el("a", { href: "/vote/?v=" + x.pub }, el("b", { text: x.name || "A vote" })),
          x.for_date ? el("small", { text: prettyDay(x.for_date) }) : null);
      })));
  }

  // ---- the button beside Add to calendar on every mission ----
  function startButton(m) {
    return el("a", { class: "btn small vote-start", href: "/vote/new/#add=" + encodeURIComponent(m.full_id).replace("%2F", "/") }, "Start a vote");
  }
  // votes this device knows have ended and nobody has looked at yet (the honey dot next to Votes)
  function waiting() {
    var now = Date.now();
    return mine().filter(function (x) { return !x.seen && (x.ended || (x.closes_at && new Date(x.closes_at).getTime() < now)); }).length;
  }

  window.AmbleVotes = { startButton: startButton, waiting: waiting, mine: mine };

  function mount() {
    var app = document.querySelector(".vote-app");
    if (!app) return;
    var view = app.getAttribute("data-view");
    if (view === "new") builder(app);
    else if (view === "mine") yourVotes(app);
    else { votePage(app); window.addEventListener("hashchange", function () { votePage(app); }); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
