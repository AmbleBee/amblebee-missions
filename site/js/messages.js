/* Messages (calendar-voting-PLAN.md, branch 2, decisions 46 and 48): this profile's conversations with AmbleBee.
   Contact messages, suggestions and reports sent while signed in show up here, open ones first. Opening one shows
   the whole conversation and marks AmbleBee's replies read (the red dot). Closed ones are read-only and leave
   Messages 90 days after closing. Everything comes from amblebee-intake through site/js/profile.js; nothing about
   the conversations is kept in this browser. /me/messages/ lists them; /me/messages/#c12 opens one. */
(function () {
  "use strict";
  var U = window.AmbleUtil, el = U.el;
  var app = document.querySelector(".messages-app");
  var P = window.AmbleProfile;
  if (!app || !P) return;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function short(iso) { var t = new Date(iso); return MONTHS[t.getMonth()].slice(0, 3) + " " + t.getDate(); }
  function long(iso) { var t = new Date(iso); return MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear(); }
  function daysTo(iso) { return Math.max(0, Math.ceil((new Date(iso) - Date.now()) / 864e5)); }
  var status = el("p", { class: "form-status", role: "status" });
  function say(text, bad) { status.textContent = text; status.classList.toggle("bad", !!bad); }

  function countdown(c) {
    var d = daysTo(c.leaves_at);
    return el("span", { class: "msg-countdown" + (d < 7 ? " is-soon" : "") },
      "Closed " + short(c.closed_at) + " · removed in " + d + (d === 1 ? " day" : " days"));
  }

  function list() {
    app.replaceChildren(el("p", { class: "hint", text: "Loading your messages…" }));
    P.messages().then(function (items) {
      var top = el("p", {}, el("a", { class: "btn small", href: "/contact/", text: "New message" }));
      if (!items.length) {
        app.replaceChildren(top, el("p", { class: "msg-empty", text: "No messages yet. If you write to us while signed in, the conversation shows up here." }), status);
        return;
      }
      var ul = el("ul", { class: "msg-list" });
      items.forEach(function (c) {
        ul.append(el("li", { class: (c.unread ? "is-unread" : "") + (c.closed ? " is-closed" : "") },
          el("a", { href: "#" + c.ref },
            el("span", { class: "msg-head" },
              el("span", { class: "chip", text: c.label }),
              el("b", { class: "msg-title", text: c.title || "Your message" }),
              c.unread ? el("span", { class: "nav-dot is-reply", "aria-hidden": "true" }) : null,
              c.unread ? el("span", { class: "sr", text: " (new reply)" }) : null),
            el("span", { class: "msg-first", text: c.first_line }),
            el("small", {}, c.closed ? countdown(c) : "Latest " + short(c.last_at) + " · " + c.status))));
      });
      app.replaceChildren(top, ul, status);
    }, problem);
  }

  function problem(ex) {
    var st = P.state();
    if (st.pinNeeded) {
      app.replaceChildren(el("p", {}, "This profile has a PIN. ", el("a", { href: "/me/settings/#profile", text: "Enter it in Your profile" }),
        " to read your messages on this device."));
      return;
    }
    app.replaceChildren(el("p", { class: "form-status bad", text: ex.message }),
      el("p", {}, el("a", { href: "#", text: "Back to Messages", onclick: function (e) { e.preventDefault(); location.hash = ""; route(); } })));
  }

  function bubble(m) {
    return el("li", { class: "msg-" + m.who },
      el("span", { class: "who", text: (m.who === "us" ? "AmbleBee" : "You") + " · " + long(m.at) }),
      el("div", { class: "body", text: m.body }));
  }

  function conversation(ref) {
    app.replaceChildren(el("p", { class: "hint", text: "Opening…" }));
    P.message(ref).then(function (v) { draw(ref, v); }, problem);
  }
  function draw(ref, v) {
    var back = el("p", { class: "msg-back" }, el("a", { href: "#", text: "‹ All messages", onclick: function (e) { e.preventDefault(); history.replaceState(null, "", location.pathname); route(); } }));
    var head = el("div", { class: "msg-convo-head" }, el("span", { class: "chip", text: v.label }), el("h2", { id: "msg-title", tabindex: "-1", text: v.title || "Your message" }));
    var about;
    if (v.closed && v.leaves_at) {
      var d = daysTo(v.leaves_at);
      about = el("p", { class: "msg-about" }, "Closed on " + long(v.closed_at) + ". It'll be removed from Messages on " + long(v.leaves_at) +
        " (in " + d + (d === 1 ? " day" : " days") + ").");
    } else if (v.kind === "contact") {
      about = el("p", { class: "msg-about", text: "Open · we'll reply here, and by email if you gave us one." });
    } else {
      about = el("p", { class: "msg-about" }, el("b", { text: v.headline + ". " }), v.text || "");
    }
    var thread = el("ol", { class: "msg-thread" }, (v.thread || []).map(bubble));
    var foot;
    if (v.can_reply) {
      var box = el("textarea", { id: "msg-reply", maxlength: v.kind === "contact" ? "5000" : "3000", rows: "4" });
      var send = el("button", { type: "submit", class: "btn primary", text: v.kind === "contact" ? "Send reply" : "Send answer" });
      foot = el("form", { class: "msg-reply" },
        el("label", { for: "msg-reply", text: v.kind === "contact" ? "Reply" : "Your answer to our question" }), box, send);
      foot.addEventListener("submit", function (e) {
        e.preventDefault();
        if (box.value.trim().length < 2) { say("Write your reply first.", true); box.focus(); return; }
        send.disabled = true;
        P.reply(ref, box.value.trim()).then(function (nv) { say("Sent."); draw(ref, nv); },
          function (ex) { send.disabled = false; say(ex.message, true); box.focus(); });
      });
    } else if (v.closed) {
      foot = el("p", {}, "Need more help? ", el("a", { href: "/contact/", text: "Start a new message" }), ".");
    } else {
      foot = el("p", { class: "hint", text: "We'll let you know here when there's news." });
    }
    app.replaceChildren(back, head, about, thread, foot, status);
    var t = document.getElementById("msg-title"); if (t) t.focus();
  }

  function route() {
    var st = P.state();
    if (!st.has) {
      app.replaceChildren(el("p", {}, "Messages are for profiles. If you write to us while signed in, the conversation shows up here, with our replies."),
        el("p", {}, el("button", { type: "button", class: "btn primary", text: "Start a free profile", onclick: function () { P.offer(false); } })));
      return;
    }
    var ref = location.hash.slice(1);
    if (/^[cs]\d+$/.test(ref)) conversation(ref); else list();
  }
  window.addEventListener("hashchange", route);
  // started a profile from this page, or the PIN was just given: show what's there now (only when that changes,
  // since every sync also announces itself)
  function mood() { var st = P.state(); return [st.has, st.pinNeeded].join(); }
  var last = mood();
  window.addEventListener("amble:profile", function () { var m = mood(); if (m !== last) { last = m; route(); } });
  route();
})();
