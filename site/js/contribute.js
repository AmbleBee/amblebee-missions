/* AmbleBee's own polls (calendar-voting-PLAN.md §2, decisions 24 to 32).
   /contribute/ lists open polls, ones being reviewed and recent results; each poll has its own page, /poll/?p=<id>.
   Polls help us decide; AmbleBee makes the final call, always with a reason. */
// "Add it as a mission" on a state page links here with ?pack=<id>; pass it on to the mission builder so the state is picked
(function () {
  var pack = new URLSearchParams(location.search).get("pack") || "";
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(pack)) return;
  document.querySelectorAll('a.path[href^="/suggest/mission/"]').forEach(function (a) {
    a.href = "/suggest/mission/?pack=" + encodeURIComponent(pack);
  });
})();

(function () {
  "use strict";
  var V = window.AmbleVotes, P = window.AmbleProfile;
  if (!V || !V.kit) return;
  var K = V.kit, el = K.el;
  var ID_RE = /^[A-Za-z0-9_-]{16}$/;

  function day(iso) { return iso ? K.prettyDay(new Date(iso).toLocaleDateString("en-CA")) : ""; }
  // the friends-vote flip clock, with a days card while a day or more is left; at zero, ask the server again
  function countdown(v, again) {
    var opening = !!v.opens_at;
    return el("div", { class: "vote-clock poll-clock" }, el("p", { class: "hint", text: opening ? "Poll opens in" : "Poll closes in" }),
      K.countdown(v, again, { at: opening ? v.opens_at : v.closes_at, days: true, label: opening ? "Poll opens in" : "Poll closes in" }));
  }
  function share(v) {
    return K.shareCard(v, { url: location.origin + "/poll/?p=" + v.pub, title: "Share this poll", text: "Help AmbleBee decide: ",
                            scan: "Scan this to open the poll." });
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
        return el("li", {}, el("a", { href: "/poll/?p=" + x.pub }, el("b", { text: x.name })),
          extra ? el("small", { text: " · " + extra }) : null);   // no vote counts on public polls: a low number reads as "nobody's here"
      }
      if (d.open.length) parts.push(el("ul", { class: "poll-list" }, d.open.map(function (x) {
        return item(x, (x.closes_at ? "closes " + day(x.closes_at) : "open") + (x.profile_required ? " · profile required" : ""));
      })));
      else parts.push(el("p", { class: "hint", text: "No polls open right now. Check back soon." }));
      if (soon.length) parts.push(el("h3", { text: "Coming up" }), el("ul", { class: "poll-list" }, soon));
      if (d.reviewing.length) parts.push(el("h3", { text: "Being reviewed" }), el("ul", { class: "poll-list" }, d.reviewing.map(function (x) { return item(x, "results soon"); })));
      if (d.results.length) parts.push(el("h3", { text: "Recent results" }), el("ul", { class: "poll-list" }, d.results.map(function (x) {
        var pop = (x.popular || []).join(" and ");
        return el("li", {}, el("a", { href: "/poll/?p=" + x.pub }, el("b", { text: x.name })),
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
      el("header", { class: "vote-head" }, stamp(), el("h1", { class: "vote-name", text: v.name }), line(),
        v.profile_required ? el("p", { class: "chip vote-signed", text: "Profile required: one vote per profile" }) : null)];
    if (v.status === "open" && v.opens_at) {
      parts.push(countdown(v, again), el("p", { class: "hint", text: "Here's what you'll be choosing from. Voting starts when it opens." }),
        el("ul", { class: "vote-options" }, v.options.map(function (o) { return K.optionCard(o, by, null, null, v.style === "ranked", null, true); })), share(v));
    } else if (v.status === "open") {
      if (v.closes_at) parts.push(countdown(v, again));
      parts.push(ballot(v, by, say, again), share(v));
    } else if (v.status === "closed") {
      parts.push(el("div", { class: "vote-card tilt-l" }, el("p", { class: "hand-title", text: "Poll closed" }),
        el("p", { text: "Results are being reviewed. They'll show here with AmbleBee's pick and the reason for it." })),
        el("ul", { class: "vote-options" }, v.options.map(function (o, i) { return K.optionCard(o, by, null, null, v.style === "ranked", i, true); })));
    } else if (v.status === "finished") {
      parts.push(results(v, by));
    } else if (v.status === "rerun") {
      parts.push(el("p", {}, "This poll got more votes than expected from people without a profile, so it's being run again with profiles required. ",
        v.rerun_by ? el("a", { href: "/poll/?p=" + v.rerun_by, text: "Vote in the new poll" }) : null));
    }
    parts.push(status);
    app.replaceChildren.apply(app, parts);
  }

  function ballot(v, by, say, again) {
    var ranked = v.style === "ranked";
    var opts = v.options;
    if (v.profile_required && !v.you.signed_in) {
      return el("div", { class: "vote-card tilt-l vote-signin" },
        el("p", {}, el("b", { text: "This poll needs a profile, so each person counts once. Profiles need to be at least a day old." })),
        el("div", { class: "backup-row" },
          P ? el("button", { type: "button", class: "btn primary", text: "Start a free profile", onclick: function () { P.offer(false, { done: function () { setTimeout(again, 0); } }); } }) : null,
          el("a", { class: "btn small", href: "/me/settings/#profile", text: "Sign in" })),
        el("ul", { class: "vote-options" }, opts.map(function (o) { return K.optionCard(o, by, null, null, ranked, null, true); })));
    }
    var pick = (v.you.voted && v.you.choice) ? v.you.choice.slice() : [];
    // Other is a card like the rest: picking it clears the options, picking an option clears it (never both)
    var otherOn = !!(v.you.voted && v.you.other && !pick.length);
    var other = v.allow_other ? el("input", { id: "poll-other", type: "text", maxlength: "120", placeholder: "Your idea",
                                             "aria-label": "Other: your idea", value: otherOn ? v.you.other : "" }) : null;
    var ul = el("ul", { class: "vote-options" });
    function otherCard() {
      var tap = el("button", { type: "button", class: "vote-option-tap", "aria-pressed": String(otherOn), onclick: function () {
        otherOn = !otherOn;
        if (otherOn) pick = [];
        paint();
        if (otherOn) other.focus();
      } }, K.honeycomb(otherOn ? "✓" : "", otherOn ? "on" : "off"),
        el("span", { class: "vote-option-name" }, el("b", { text: "Other" }), el("small", { text: "We can't think of everything, and your opinion matters. Tell us what you'd pick!" })));
      return el("li", { class: "vote-option poll-other-card tilt-" + (opts.length % 2 ? "r" : "l") + (otherOn ? " is-picked" : "") }, tap, other);
    }
    function paint() {
      var cards = opts.map(function (o, i) {
        var at = pick.indexOf(o.id);
        return K.optionCard(o, by, at, function () {
          if (ranked) { if (at >= 0) pick.splice(at, 1); else pick.push(o.id); } else pick = at >= 0 ? [] : [o.id];
          if (pick.length) otherOn = false;
          paint();
        }, ranked, i, true);
      });
      if (other) cards.push(otherCard());
      ul.replaceChildren.apply(ul, cards);
    }
    if (other) other.addEventListener("input", function () {   // typing an idea picks Other
      if (!otherOn && other.value.trim()) { otherOn = true; pick = []; var at = other.selectionStart; paint(); other.focus(); other.setSelectionRange(at, at); }
    });
    paint();
    var cast = el("button", { type: "submit", class: "btn primary vote-cast", text: v.you.voted ? "Change my vote" : "Cast my vote!" });
    var form = el("form", { class: "vote-ballot", novalidate: true },
      el("p", { class: "hand-label", text: ranked ? "Tap your favorite first! Then keep tapping to rank the rest, if you like." : "Tap the one you'd pick." }),
      ul,
      other ? el("p", { class: "hint", text: "Only AmbleBee sees what you write in Other. It's never shown publicly." }) : null,
      cast,
      v.you.voted ? el("p", { class: "vote-in", text: "Your vote is in. You can change it until the poll closes." }) : null);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (otherOn && !other.value.trim()) { say("Type your idea in the Other box.", true); other.focus(); return; }
      if (!pick.length && !otherOn) { say(ranked ? "Tap your favorite first." : "Tap the one you'd pick.", true); return; }
      cast.disabled = true;
      if (window.AmbleStamps) window.AmbleStamps.fresh();   // what's earned so far counts as seen, so only Had My Say lands
      var body = otherOn ? { choice: [], other: other.value.trim() } : { choice: pick };
      K.api("/polls/" + v.pub + "/ballot", "POST", body).then(function (r) {
        cast.disabled = false;
        if (r.status !== 200) { say(K.problem(r), true); return; }
        draw(document.querySelector(".poll-app"), r.body, by, again);
        var s = document.querySelector(".poll-app .form-status");
        if (s) s.textContent = "Your vote is in. Thanks for helping us decide!";
        // signed in: the sync brings Had My Say along, and it lands right here the first time
        if (P && P.has() && P.sync) P.sync(true).then(function () {
          var ST = window.AmbleStamps, news = ST ? ST.fresh().filter(function (x) { return x.id === "had-my-say"; }) : [];
          var box = news.length && ST.landing(news, true), st = document.querySelector(".poll-app .form-status");
          if (box && st) st.parentNode.insertBefore(box, st.nextSibling);
        });
      });
    });
    return form;
  }

  // Results: the same cards as voting, not tappable, with a bar behind each for its share and ✓ on the most votes
  function results(v, by) {
    var r = v.result || {}, n = names(v), st = v.staff || {}, ranked = v.style === "ranked";
    var scores = {}; (r.scores || []).forEach(function (x) { scores[x.option] = x; });
    var total = (r.scores || []).reduce(function (t, x) { return t + x.points; }, 0);
    var top = (r.scores || []).filter(function (x) { return x.place === 1 && r.voters; }).map(function (x) { return x.option; });
    var order = v.options.slice().sort(function (a, b) { return ((scores[b.id] || {}).points || 0) - ((scores[a.id] || {}).points || 0); });
    var cards = order.map(function (o, i) {
      var x = scores[o.id] || { points: 0 }, share = total ? Math.round(x.points * 100 / total) : 0, won = top.indexOf(o.id) >= 0;
      var card = K.optionCard(o, by, null, null, ranked, i, true);
      card.classList.add("poll-result");
      if (won) card.classList.add("is-winner");
      card.style.setProperty("--share", share + "%");
      var tap = card.querySelector(".vote-option-tap");
      tap.insertBefore(K.honeycomb(won ? "✓" : "", won ? "on" : "off"), tap.firstChild);
      // shares only, never how many voted: the bar and the percent tell the story without a small number
      card.querySelector(".vote-option-name").append(el("small", { text: share + "%" + (st.pick === o.id ? " · Staff pick" : "") }));
      card.setAttribute("aria-label", o.name + ": " + share + " percent" + (won ? ", most votes" : ""));
      return card;
    });
    var same = top.length === 1 && st.pick === top[0];
    return el("section", { class: "vote-results poll-results" },
      el("ul", { class: "vote-options" }, cards),
      el("div", { class: "vote-card vote-plan tilt-r" },
        el("p", { class: "hand-title", text: same ? "Staff pick: the same!" : "Staff pick: " + n[st.pick] }),
        st.reason ? el("p", { text: st.reason }) : null,
        st.decided_at ? el("p", { class: "hint", text: "Decided " + day(st.decided_at) }) : null));
  }

  function mount() {
    var app = document.querySelector(".poll-app");
    if (!app) return;
    var pub = new URLSearchParams(location.search).get("p");
    if (app.getAttribute("data-view") === "poll") {
      if (pub && ID_RE.test(pub)) { document.title = "AmbleBee poll"; one(app, pub); }
      else app.replaceChildren(el("p", {}, "This link is missing its poll. ", el("a", { href: "/contribute/#polls", text: "See AmbleBee's polls" }), "."));
    } else if (pub && ID_RE.test(pub)) location.replace("/poll/?p=" + pub);   // early links pointed here
    else list(app);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
