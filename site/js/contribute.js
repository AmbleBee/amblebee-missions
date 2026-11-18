/* AmbleBee's own polls on the Contribute page (calendar-voting-PLAN.md §2, decisions 24 to 32).
   /contribute/ lists open polls, ones being reviewed and recent results; /contribute/?p=<id> shows one poll.
   Polls help us decide; AmbleBee makes the final call, always with a reason. */
(function () {
  "use strict";
  var V = window.AmbleVotes, P = window.AmbleProfile;
  if (!V || !V.kit) return;
  var K = V.kit, el = K.el;
  var ID_RE = /^[A-Za-z0-9_-]{16}$/;

  function day(iso) { return iso ? K.prettyDay(new Date(iso).toLocaleDateString("en-CA")) : ""; }
  // "2 days, 3 hours and 5 minutes" / "3 hours and 5 minutes" / "5 minutes"
  function span(ms) {
    var m = Math.max(0, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
    var bits = [];
    if (d) bits.push(d + (d === 1 ? " day" : " days"));
    if (d || h) bits.push(h + (h === 1 ? " hour" : " hours"));
    bits.push(mi + (mi === 1 ? " minute" : " minutes"));
    return bits.length > 1 ? bits.slice(0, -1).join(", ") + " and " + bits[bits.length - 1] : bits[0];
  }
  // Poll opens in… / Poll closes in…, by the server's clock; when it hits zero, ask the server again
  var tick = null;
  function countdown(v, again) {
    var opening = !!v.opens_at, at = new Date(opening ? v.opens_at : v.closes_at).getTime();
    var skew = Date.now() - new Date(v.now).getTime();
    var box = el("p", { class: "poll-clock", role: "timer" });
    function paint() {
      var left = at - (Date.now() - skew);
      box.replaceChildren(el("b", { text: (opening ? "Poll opens in " : "Poll closes in ") + span(left) }));
      if (left <= 0) { clearInterval(tick); tick = null; setTimeout(again, 1500); }
    }
    clearInterval(tick);
    paint();
    tick = setInterval(paint, 15000);
    return box;
  }
  function names(v) { var m = {}; v.options.forEach(function (o) { m[o.id] = o.name; }); return m; }
  function stamp() { return el("p", { class: "chip poll-stamp", text: "AmbleBee poll" }); }
  function line() { return el("p", { class: "hint", text: "Polls help us decide. AmbleBee makes the final call." }); }

  // ---------- the list: /contribute/ ----------
  function list(app) {
    K.api("/polls/official").then(function (r) {
      if (r.status !== 200) { app.replaceChildren(el("p", { class: "hint", text: "Polls can't be loaded right now. Try again later." })); return; }
      var d = r.body, parts = [];
      var soon = (d.upcoming || []).map(function (x) { return item(x, "opens " + day(x.opens_at)); });
      function item(x, extra) {
        return el("li", {}, el("a", { href: "/contribute/?p=" + x.pub }, el("b", { text: x.name })),
          el("small", { text: " · " + x.voters + (x.voters === 1 ? " vote" : " votes") + (extra ? " · " + extra : "") }));
      }
      if (d.open.length) parts.push(el("ul", { class: "poll-list" }, d.open.map(function (x) {
        return item(x, (x.closes_at ? "closes " + day(x.closes_at) : "open") + (x.profile_required ? " · profile required" : ""));
      })));
      else parts.push(el("p", { class: "hint", text: "No polls open right now. Check back soon." }));
      if (soon.length) parts.push(el("h3", { text: "Coming up" }), el("ul", { class: "poll-list" }, soon));
      if (d.reviewing.length) parts.push(el("h3", { text: "Being reviewed" }), el("ul", { class: "poll-list" }, d.reviewing.map(function (x) { return item(x, "results soon"); })));
      if (d.results.length) parts.push(el("h3", { text: "Recent results" }), el("ul", { class: "poll-list" }, d.results.map(function (x) {
        var pop = (x.popular || []).join(" and ");
        return el("li", {}, el("a", { href: "/contribute/?p=" + x.pub }, el("b", { text: x.name })),
          el("small", { text: " · Most votes: " + (pop || "no votes") + " · Staff pick: " + (x.staff === pop ? "the same" : x.staff) }));
      })));
      app.replaceChildren.apply(app, parts);
    });
  }

  // ---------- one poll: /contribute/?p=<id> ----------
  function one(app, pub) {
    function fetchIt() {
      K.api("/polls/" + pub).then(function (r) {
        if (r.status === 404) {
          app.replaceChildren(el("p", {}, "This poll has been removed. ", el("a", { href: "/contribute/#polls", text: "See the other polls" }), "."));
          return;
        }
        if (r.status !== 200) { app.replaceChildren(el("p", { class: "form-status bad", text: K.problem(r) })); return; }
        if (r.body.kind !== "official") { location.replace("/vote/?v=" + pub); return; }
        K.missions().then(function (by) { draw(app, r.body, by, fetchIt); });
      });
    }
    fetchIt();
  }

  function draw(app, v, by, again) {
    var status = el("p", { class: "form-status", role: "status" });
    function say(t, bad) { status.textContent = t; status.classList.toggle("bad", !!bad); }
    var parts = [el("p", {}, el("a", { href: "/contribute/#polls", text: "‹ All polls" })),
      el("header", { class: "vote-head" }, stamp(), el("h2", { class: "vote-name", text: v.name }), line(),
        v.profile_required ? el("p", { class: "chip vote-signed", text: "Profile required: one vote per profile" }) : null)];
    if (v.status === "open" && v.opens_at) {
      parts.push(countdown(v, again), el("p", { class: "hint", text: "Here's what you'll be choosing from. Voting starts when it opens." }),
        el("ul", { class: "vote-options" }, v.options.map(function (o) {
          var c = Object.assign({}, o); if (o.explain) c.place = o.explain; return K.optionCard(c, by, null, null, v.style === "ranked");
        })));
    } else if (v.status === "open") {
      if (v.closes_at) parts.push(countdown(v, again));
      parts.push(el("p", { class: "vote-count" }, el("b", { text: v.voters + (v.voters === 1 ? " person has voted" : " people have voted") })));
      parts.push(ballot(v, by, say, again));
    } else if (v.status === "closed") {
      parts.push(el("div", { class: "vote-card tilt-l" }, el("p", { class: "hand-title", text: "Poll closed" }),
        el("p", { text: "Results are being reviewed. They'll show here with AmbleBee's pick and the reason for it." })));
    } else if (v.status === "finished") {
      parts.push(results(v));
    } else if (v.status === "rerun") {
      parts.push(el("p", {}, "This poll got more votes than expected from people without a profile, so it's being run again with profiles required. ",
        v.rerun_by ? el("a", { href: "/contribute/?p=" + v.rerun_by, text: "Vote in the new poll" }) : null));
    }
    parts.push(status);
    app.replaceChildren.apply(app, parts);
  }

  function ballot(v, by, say, again) {
    var ranked = v.style === "ranked";
    var opts = v.options.map(function (o) { var c = Object.assign({}, o); if (o.explain) c.place = o.explain; return c; });
    if (v.profile_required && !v.you.signed_in) {
      return el("div", { class: "vote-card tilt-l vote-signin" },
        el("p", {}, el("b", { text: "This poll needs a profile, so each person counts once. Profiles need to be at least a day old." })),
        el("div", { class: "backup-row" },
          P ? el("button", { type: "button", class: "btn primary", text: "Start a free profile", onclick: function () { P.offer(false, { done: function () { setTimeout(again, 0); } }); } }) : null,
          el("a", { class: "btn small", href: "/me/settings/#profile", text: "Sign in" })),
        el("ul", { class: "vote-options" }, opts.map(function (o) { return K.optionCard(o, by, null, null, ranked); })));
    }
    var pick = (v.you.voted && v.you.choice) ? v.you.choice.slice() : [];
    var ul = el("ul", { class: "vote-options" });
    function paint() {
      ul.replaceChildren.apply(ul, opts.map(function (o, i) {
        var at = pick.indexOf(o.id);
        return K.optionCard(o, by, at, function () {
          if (ranked) { if (at >= 0) pick.splice(at, 1); else pick.push(o.id); } else pick = at >= 0 ? [] : [o.id];
          paint();
        }, ranked, i);
      }));
    }
    paint();
    var other = v.allow_other ? el("input", { id: "poll-other", type: "text", maxlength: "120" }) : null;
    var cast = el("button", { type: "submit", class: "btn primary vote-cast", text: v.you.voted ? "Change my vote" : "Cast my vote!" });
    var form = el("form", { class: "vote-ballot", novalidate: true },
      el("p", { class: "hand-label", text: ranked ? "Tap your favorite first! Then keep tapping to rank the rest, if you like." : "Tap the one you'd pick." }),
      ul,
      other ? el("div", { class: "done-field" }, el("label", { for: "poll-other" }, "Other ", el("span", { class: "opt", text: "(optional)" })), other,
        el("p", { class: "hint", text: "Something we missed? Only AmbleBee sees this, never shown publicly." })) : null,
      cast,
      v.you.voted ? el("p", { class: "vote-in", text: "Your vote is in. You can change it until the poll closes." }) : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!pick.length) { say(ranked ? "Tap your favorite first." : "Tap the one you'd pick.", true); return; }
      cast.disabled = true;
      var body = { choice: pick };
      if (other && other.value.trim()) body.other = other.value.trim();
      K.api("/polls/" + v.pub + "/ballot", "POST", body).then(function (r) {
        cast.disabled = false;
        if (r.status !== 200) { say(K.problem(r), true); return; }
        if (P && P.has() && P.sync) P.sync();   // brings Had My Say along
        draw(document.querySelector(".poll-app"), r.body, by, again);
        var s = document.querySelector(".poll-app .form-status");
        if (s) s.textContent = "Your vote is in. Thanks for helping us decide!";
      });
    });
    return form;
  }

  function results(v) {
    var r = v.result || {}, n = names(v), st = v.staff || {};
    var unit = function (p) { return v.style === "ranked" ? (p === 1 ? " point" : " points") : (p === 1 ? " vote" : " votes"); };
    var top = (r.scores || []).filter(function (x) { return x.place === 1; }).map(function (x) { return n[x.option]; });
    var same = top.length === 1 && n[st.pick] === top[0];
    return el("section", { class: "vote-results poll-results" },
      el("h3", { text: "Most votes" }),
      el("p", { class: "hand-title", text: r.voters ? top.join(" and ") : "No one voted" }),
      r.voters ? el("ol", { class: "vote-rest" }, (r.scores || []).map(function (x) { return el("li", { text: n[x.option] + " · " + x.points + unit(x.points) }); })) : null,
      el("div", { class: "vote-card vote-plan tilt-r" },
        el("p", { class: "hand-title", text: same ? "Staff pick: the same!" : "Staff pick: " + n[st.pick] }),
        st.reason ? el("p", { text: st.reason }) : null,
        st.decided_at ? el("p", { class: "hint", text: "Decided " + day(st.decided_at) }) : null));
  }

  function mount() {
    var app = document.querySelector(".poll-app");
    if (!app) return;
    var pub = new URLSearchParams(location.search).get("p");
    if (pub && ID_RE.test(pub)) {
      one(app, pub);
      var h = document.getElementById("polls"); if (h) h.scrollIntoView();
    } else list(app);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
