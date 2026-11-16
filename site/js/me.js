/* The profile pages. data-view="profile" (/me/): the missions marked done in this browser, under the stamp book
   (site/js/book.js). data-view="settings" (/me/settings/): the two things stamps need (home state, anniversary),
   the "Not for us" list, and a backup code or file to move it all to another device.
   Reads and writes through site/js/done.js; stamps come from site/js/stamps.js. */
(function () {
  "use strict";
  var D = window.AmbleDone;
  var ST = window.AmbleStamps;
  var P = window.AmbleProfile;   // site/js/profile.js
  var app = document.querySelector(".me-app");
  if (!app || !D) return;
  var VIEW = app.getAttribute("data-view") === "settings" ? "settings" : "profile";

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function stampNews() {   // stamps that something done on this page just earned, as words for the status line
    if (!ST) return "";
    var news = ST.fresh();
    if (!news.length) return "";
    return " That earned " + (news.length === 1 ? "a new stamp: " : news.length + " new stamps: ") + news.map(function (x) { return x.name; }).join(", ") + ".";
  }
  function pretty(iso) { var t = new Date(iso); return MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear(); }
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
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return e;
  }
  var status = el("p", { class: "form-status", role: "status" });
  function say(text, bad) { status.textContent = text; status.classList.toggle("bad", !!bad); }

  function draw() {
    var list = D.list();
    var hidden = Array.from(D.hidden());
    var missions = new Set(list.map(function (c) { return c.mission; }));
    app.replaceChildren();
    if (VIEW === "settings") { drawSettings(list, hidden); return; }

    // ---- what you've done ----
    var top = el("section", { class: "me-done", "aria-labelledby": "me-done-title" });
    if (!list.length) {
      top.append(el("h2", { id: "me-done-title", text: "Nothing marked done yet" }),
        el("p", {}, "When you finish a mission, press ", el("b", { text: "Mark done" }), " on it and it shows up here, with the day you did it and how it went."),
        el("p", {}, el("a", { class: "btn primary", href: "/" }, "Open a mission")));
    } else {
      var oldest = list[list.length - 1];
      top.append(el("h2", { id: "me-done-title" },
        missions.size + (missions.size === 1 ? " mission done" : " missions done")),
        el("p", { class: "hint", text: (list.length > missions.size ? list.length + " times in all, " : "") + "since " + pretty(oldest.done_at) + "." }));
      var ul = el("ul", { class: "me-list" });
      list.forEach(function (c) {
        var bits = [pretty(c.done_at)];
        if (c.rating === "up") bits.push("Loved it");
        if (c.rating === "down") bits.push("Not really");
        if (c.as_date && c.snapshot.mode !== "date") bits.push("As a date");
        var remove = el("button", { type: "button", class: "linkish", "aria-label": "Remove " + c.name + ", " + pretty(c.done_at), text: "Remove" });
        remove.addEventListener("click", function () {
          if (remove.dataset.sure) {
            var gone = ST && ST.wouldLose ? ST.wouldLose(c.rid).map(function (s) { return s.name; }) : [];
            D.remove(c.rid); say("Removed " + c.name + "." + (gone.length ? " " + gone.join(", ") + (gone.length === 1 ? " was" : " were") + " taken back." : ""));
            var next = app.querySelector(".me-list .linkish"); if (next) next.focus();
            return;
          }
          var lost = ST && ST.wouldLose ? ST.wouldLose(c.rid).map(function (s) { return s.name; }) : [];
          remove.dataset.sure = "1";
          remove.textContent = lost.length ? "Remove for good? It takes back " + lost.join(", ") : "Remove for good?";
          remove.setAttribute("aria-label", "Remove " + c.name + " for good?" + (lost.length ? " It takes back the stamp " + lost.join(", ") + "." : ""));
        });
        ul.append(el("li", {},
          el("a", { href: "/missions/" + encodeURIComponent(c.slug) + "/", text: c.name }),
          el("small", { text: bits.join(" · ") }),
          c.note ? el("p", { class: "me-note", text: c.note }) : null,
          remove));
      });
      top.append(ul);
    }
    app.append(top, status);
  }

  function drawSettings(list, hidden) {
    // ---- the profile: link, recovery email, another device, signing out ----
    if (P) app.append(profileSection());
    // the rest belongs to a profile: until there is one, Settings is only "Your profile"
    if (P && !P.has()) { app.append(status); return; }
    // ---- the two things stamps need ----
    if (ST) app.append(stampsSection());

    // ---- hidden from picks ----
    var hiddenBox = el("section", { class: "me-hidden", id: "not-for-us", "aria-labelledby": "me-hidden-title" },
      el("h2", { id: "me-hidden-title", text: "Not for us" }));
    app.append(hiddenBox);
    if (!hidden.length) {
      hiddenBox.append(el("p", { class: "hint", text: "When you rate a mission \u201cNot really\u201d you can mark it \u201cNot for us\u201d, and it's never picked for you again on this device. Those missions show up here, so you can bring them back." }));
    } else {
      var names = {};
      list.forEach(function (c) { names[c.mission] = c.name; });
      var hul = el("ul", { class: "me-list" });
      hidden.forEach(function (id) {
        hul.append(el("li", {},
          el("span", { class: "me-name", text: names[id] || id.split("/")[1].replace(/-/g, " ") }),
          el("button", { type: "button", class: "linkish", text: "Show it again", onclick: function () {
            D.hide(id, false); say("It can be picked for you again.");
          } })));
      });
      hiddenBox.append(el("p", { class: "hint", text: "These are never picked for you on this device. They still show in Every mission and search." }), hul);
    }

    // ---- backup ----
    var codeBox = el("textarea", { id: "me-code", class: "me-code", rows: "3", readonly: true, "aria-label": "Your backup code", hidden: true });
    var copy = el("button", { type: "button", class: "btn small", text: "Copy a backup code" });
    copy.addEventListener("click", async function () {
      codeBox.value = D.exportCode(); codeBox.hidden = false;
      try { await navigator.clipboard.writeText(codeBox.value); say("Backup code copied. Paste it somewhere safe, like a note to yourself."); }
      catch (e) { codeBox.focus(); codeBox.select(); say("Select the code and copy it."); }
    });
    var file = el("button", { type: "button", class: "btn small", text: "Download a backup file" });
    file.addEventListener("click", function () {
      var url = URL.createObjectURL(new Blob([D.exportJson()], { type: "application/json" }));
      var a = el("a", { href: url, download: "amblebee-missions-" + new Date().toISOString().slice(0, 10) + ".json" });
      document.body.append(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      say("Backup file saved.");
    });
    var paste = el("textarea", { id: "me-paste", class: "me-code", rows: "3", placeholder: "AMB1:…" });
    var add = el("button", { type: "button", class: "btn small", text: "Add from this code" });
    add.addEventListener("click", function () { bring(paste.value); });
    var pick = el("input", { id: "me-file", type: "file", accept: ".json,application/json" });
    pick.addEventListener("change", function () {
      var f = pick.files && pick.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () { bring(String(r.result || "")); pick.value = ""; };
      r.readAsText(f);
    });
    function bring(text) {
      var res = D.importText(text);
      if (!res) { say("That doesn't look like an AmbleBee backup. Check you copied all of it.", true); return; }
      paste.value = "";
      say((res.added ? "Added " + res.added + (res.added === 1 ? " mission." : " missions.") + (res.total > res.added ? " The rest were already here." : "")
        : "Everything in that backup was already here.") + stampNews());
    }
    app.append(el("section", { class: "me-backup", id: "keep", "aria-labelledby": "me-backup-title" },
      el("h2", { id: "me-backup-title", text: "Keep a copy" }),
      el("p", {}, "Your missions, stamps and settings live in this browser only. Clearing your browser's data, or a new phone, would lose them, so keep a backup. A code or file holds all of it and can be added on any device."),
      el("div", { class: "backup-row" }, copy, file),
      codeBox,
      el("div", { class: "me-import" },
        el("label", { for: "me-paste", text: "Bring in a backup code" }), paste,
        el("div", { class: "backup-row" }, add),
        el("label", { for: "me-file", text: "Or a backup file" }), pick)),
      status);
    app.append(removeSection());   // last, after Keep a copy
  }

  function stampsSection() {
    var set = D.settings();
    var sec = el("section", { class: "me-stamps", id: "for-stamps", "aria-labelledby": "me-stamps-title" },
      el("h2", { id: "me-stamps-title", text: "For your stamps" }));

    // home state, for Home Sweet Home
    var state = el("select", { id: "me-home", onchange: function () {
      D.setSettings({ home_state: state.value }); say((state.value ? "Home state saved." : "Home state cleared.") + stampNews()); refocus("me-home");
    } }, el("option", { value: "", text: "Not set" }));
    Object.keys(ST.states).forEach(function (id) { state.append(el("option", { value: id, text: ST.states[id], selected: set.home_state === id })); });

    // anniversary, for Our Anniversary: just the month and day
    var parts = (set.anniversary || "").split("-");
    var month = el("select", { id: "me-ann-month", "aria-label": "Anniversary month" }, el("option", { value: "", text: "Month" }));
    FULL_MONTHS.forEach(function (m, i) { var v = ("0" + (i + 1)).slice(-2); month.append(el("option", { value: v, text: m, selected: parts[0] === v })); });
    var day = el("select", { id: "me-ann-day", "aria-label": "Anniversary day" }, el("option", { value: "", text: "Day" }));
    for (var d = 1; d <= 31; d++) { var v = ("0" + d).slice(-2); day.append(el("option", { value: v, text: String(d), selected: parts[1] === v })); }
    function saveAnn(which) {
      if (!month.value || !day.value) {
        if (!month.value && !day.value && set.anniversary) { D.setSettings({ anniversary: null }); say("Anniversary cleared."); refocus(which); }
        return;
      }
      var dd = Math.min(+day.value, DAYS_IN[+month.value - 1]);
      D.setSettings({ anniversary: month.value + "-" + ("0" + dd).slice(-2) });
      say("Anniversary saved." + stampNews()); refocus(which);
    }
    month.addEventListener("change", function () { saveAnn("me-ann-month"); });
    day.addEventListener("change", function () { saveAnn("me-ann-day"); });

    sec.append(el("p", { class: "hint", text: "Two stamps use these: one for missions close to home, one for a date on your anniversary. Both are optional." }),
      el("div", { class: "me-settings" },
      el("div", { class: "done-field" }, el("label", { for: "me-home" }, "Home state ", el("span", { class: "opt", text: "(optional)" })), state),
      el("fieldset", { class: "done-field me-ann" }, el("legend", {}, "Anniversary ", el("span", { class: "opt", text: "(optional)" })),
        el("div", { class: "me-ann-row" }, month, day))));
    return sec;
  }
  // ---- Remove account: asks once more before anything goes ----
  function removeSection() {
    var sec = el("section", { class: "me-remove", id: "remove", "aria-labelledby": "me-remove-title" },
      el("h2", { id: "me-remove-title", text: "Remove account" }),
      el("p", {}, P && P.has() ? "Removes your profile from our server and everything on this device: your missions, notes, stamps, Not for us list and settings. Your profile link stops working. It can't be undone, so keep a copy first if you might want it back."
        : "Removes everything on this device: your missions, notes, stamps, Not for us list and settings. It can't be undone, so keep a copy first if you might want it back."));
    var ask = el("button", { type: "button", class: "btn small me-remove-btn", text: "Remove account", onclick: function () {
      ask.hidden = true; sure.hidden = false; sure.querySelector(".me-remove-cancel").focus();
    } });
    var sure = el("div", { class: "me-remove-sure", role: "group", "aria-label": "Are you sure?", hidden: true },
      el("p", {}, el("b", { text: "Are you sure?" }), " Everything listed above goes, and your stamps with it."),
      el("div", { class: "backup-row" },
        el("button", { type: "button", class: "btn small me-remove-yes", text: "Yes, remove account", onclick: function () {
          var yes = this;
          yes.disabled = true;
          (P ? P.remove() : Promise.resolve()).then(function () {
            D.removeAll(); say(P && P.has() === false ? "Your account was removed." : "Your account was removed from this device.");
            var h = document.getElementById("me-profile-title") || document.getElementById("me-stamps-title"); if (h) { h.tabIndex = -1; h.focus(); }
          }, function (ex) { yes.disabled = false; say(ex.message, true); });
        } }),
        el("button", { type: "button", class: "btn small me-remove-cancel", text: "Cancel", onclick: function () {
          sure.hidden = true; ask.hidden = false; ask.focus();
        } })));
    sec.append(ask, sure);
    return sec;
  }
  // ---- Settings: the profile ----
  function profileSection() {
    var st = P.state();
    var sec = el("section", { class: "me-profile", id: "profile", "aria-labelledby": "me-profile-title" },
      el("h2", { id: "me-profile-title", text: "Your profile" }));
    var busy = function (b, text) { b.disabled = true; b.dataset.was = b.textContent; b.textContent = text; };
    var free = function (b) { b.disabled = false; if (b.dataset.was) b.textContent = b.dataset.was; };
    if (st.has && st.locked) {
      var uIn = el("input", { id: "me-unlock", type: "email", autocomplete: "email", placeholder: "you@example.com" });
      var uBtn = el("button", { type: "submit", class: "btn small", text: "Unlock my notes" });
      var uForm = el("form", { class: "me-unlock-form" },
        el("label", { for: "me-unlock", text: "Your notes are locked. Type your recovery email to unlock them" }),
        el("div", { class: "backup-row" }, uIn, uBtn),
        el("p", { class: "hint", text: "Your notes are locked with your profile link, and you have a new link now. Your recovery email opens them once, then they're locked with the new link. Everything else in your profile is already here." }));
      uForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!uIn.value.trim()) { uIn.focus(); return; }
        busy(uBtn, "Unlocking…");
        P.unlock(uIn.value.trim()).then(function () { say("Your notes are unlocked."); draw(); refocus("me-profile-title"); },
          function (ex) { free(uBtn); say(ex.message, true); uIn.focus(); });
      });
      sec.append(uForm);
    }
    if (st.has) {
      sec.append(el("p", {}, "Your missions, stamps and settings are saved to your profile, so clearing this browser won't lose them. Your notes are locked with your link before they leave this device, so we can't read them."));
      var shown = el("div", { class: "me-link", hidden: true });
      var show = el("button", { type: "button", class: "btn small me-show-link", text: "Show my profile link and QR code", onclick: function () {
        var qr = null;
        try { qr = window.AmbleQR ? window.AmbleQR.svg(P.link(), { label: "QR code for your profile link" }) : null; } catch (e) { qr = null; }
        shown.replaceChildren(
          qr ? el("div", { class: "me-qr" }, qr, el("div", {},
            el("p", {}, el("b", { text: "On your phone? Scan this with its camera." })),
            el("p", { class: "hint", text: "Your profile opens there and stays signed in on that phone, so your missions and stamps follow you. Anyone who scans it can open your profile, so don't share a photo of it." }))) : null,
          el("p", { class: "hint", text: "Or open this link on another phone or computer. Anyone with it can open your profile, so keep it to yourself." }),
          copy("me-link", P.link(), "Your profile link"),
          el("p", { class: "hint" }, "Recovery code: ", el("code", { class: "recovery-code", text: P.key() })));
        shown.hidden = false; show.hidden = true; shown.querySelector("input").focus();
      } });
      sec.append(show, shown);

      // recovery email (changing it needs the notes key, so not while the notes are locked)
      var mail = el("div", { class: "me-email", hidden: st.locked });
      var input = el("input", { id: "me-email", type: "email", autocomplete: "email", maxlength: "200", placeholder: "you@example.com" });
      var addBtn = el("button", { type: "submit", class: "btn small", text: st.email ? "Change recovery email" : "Add recovery email" });
      var form = el("form", { class: "me-email-form" },
        el("label", { for: "me-email" }, st.email ? "A recovery email is set. Use a different one:" : "Recovery email ", st.email ? null : el("span", { class: "opt", text: "(optional)" })),
        el("div", { class: "backup-row" }, input, addBtn));
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!input.value.trim()) { input.focus(); return; }
        busy(addBtn, "Sending…");
        P.setEmail(input.value.trim()).then(function () { say("Saved. We've emailed your profile link and recovery code there."); draw(); refocus("me-profile-title"); },
          function (ex) { free(addBtn); say(ex.message, true); input.focus(); });
      });
      mail.append(form, el("p", { class: "hint", text: "If you lose your link, we can email a new one there. We send your link there once, then keep only a scrambled fingerprint of the address, never the address itself. We'll never email you for anything else. This browser also remembers it to fill in the contact, report and suggestion forms for you." }));
      if (st.email) {
        var rm = el("button", { type: "button", class: "linkish", text: "Remove the recovery email", onclick: function () {
          busy(rm, "Removing…");
          P.setEmail("").then(function () { say("Recovery email removed."); draw(); refocus("me-profile-title"); }, function (ex) { free(rm); say(ex.message, true); });
        } });
        mail.append(rm);
      }
      sec.append(mail);

      var out = el("button", { type: "button", class: "btn small me-sign-out", text: "Sign out of this device", onclick: function () {
        if (out.dataset.sure) {
          P.signOut(); say("Signed out. Your profile is still there; open your link to come back."); draw(); refocus("me-profile-title"); return;
        }
        out.dataset.sure = "1"; out.textContent = "Sign out? This device forgets your missions";
      } });
      sec.append(el("div", { class: "me-out" }, out,
        el("p", { class: "hint", text: "Your profile stays on our server. Save your link first: it's how you open it again." })));
      return sec;
    }

    if (st.gone) sec.append(el("p", { class: "form-status bad", text: "This device's profile link has stopped working, usually because a new link was emailed. Open the newest link from your email, or start a new profile. Your missions are still on this device." }));
    else sec.append(el("p", {}, "Your missions are only in this browser. A free profile keeps them safe on our server, so clearing your browser or a new phone won't lose them. No name or password."));
    sec.append(el("p", {}, el("button", { type: "button", class: "btn primary me-start", text: "Start a free profile", onclick: function () { P.offer(false); } })));

    // already have one: paste the link or code, or get a new link by email
    var code = el("input", { id: "me-open", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Your profile link or recovery code" });
    var openForm = el("form", { class: "me-open-form" },
      el("label", { for: "me-open", text: "Already have a profile? Paste its link or recovery code" }),
      el("div", { class: "backup-row" }, code, el("button", { type: "submit", class: "btn small", text: "Open it here" })));
    openForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var m = /([A-Za-z0-9_-]{22})\s*$/.exec(code.value.trim());
      if (!m) { say("That doesn't look like a profile link or recovery code. Check you copied all of it.", true); code.focus(); return; }
      say("Opening your profile…");
      P.open(m[1]).then(function (s2) {
        if (s2 && s2.gone) say("That link has stopped working. If you asked for a new one, use the link in your newest email.", true);
        else if (s2 && s2.error) say(s2.error, true);
        else say("Your profile is open on this device.");
        draw(); refocus("me-profile-title");
      });
    });
    var startedAt = Date.now();
    var lostIn = el("input", { id: "me-lost", type: "email", autocomplete: "email", placeholder: "you@example.com" });
    var lostBtn = el("button", { type: "submit", class: "btn small", text: "Email me a new link" });
    var lostForm = el("form", { class: "me-lost-form" },
      el("label", { for: "me-lost", text: "Lost your link? Type your recovery email" }),
      el("div", { class: "backup-row" }, lostIn, lostBtn),
      el("p", { class: "hint", text: "If a profile has that recovery email, we'll email it a new link. The old link stops working." }));
    lostForm.addEventListener("submit", function (e) {
      e.preventDefault();
      busy(lostBtn, "Sending…");
      P.lost(lostIn.value.trim(), startedAt).then(function () {
        free(lostBtn); lostIn.value = "";
        say("If a profile has that recovery email, a new link is on its way. Check your spam folder too.");
      }, function (ex) { free(lostBtn); say(ex.message, true); lostIn.focus(); });
    });
    sec.append(openForm, lostForm);
    return sec;
  }
  function copy(id, value, label) {
    var box = el("input", { id: id, class: "link-box", type: "text", readonly: true, value: value, "aria-label": label });
    return el("div", { class: "copy-row" }, box, el("button", { type: "button", class: "btn small", text: "Copy", onclick: function () {
      box.select();
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).then(function () { say("Copied."); }, function () { say("Select it and copy."); });
    } }));
  }

  // ---- the profile line at the top of /me/ ----
  function profileBar() {
    var bar = document.querySelector(".profile-bar");
    if (!bar || !P) return;
    var st = P.state();
    var ago = function (ms) {
      var m = Math.round((Date.now() - ms) / 60000);
      return m < 1 ? "just now" : m < 60 ? m + (m === 1 ? " minute ago" : " minutes ago") : "earlier today";
    };
    if (st.has && st.locked) {
      bar.className = "profile-bar is-gone";
      bar.replaceChildren(el("p", {}, el("b", { text: "Your notes are locked. " }),
        "You opened a new link, so your recovery email is needed once to unlock them."),
        el("a", { href: "/me/settings/#profile", text: "Unlock my notes" }));
    } else if (st.has) {
      bar.className = "profile-bar is-saved";
      bar.replaceChildren(el("p", {}, el("b", { text: "✓ Saved to your profile" }),
        st.syncing ? " · saving…" : st.error ? " · " + st.error : st.last ? " · synced " + ago(st.last) : ""),
        el("a", { href: "/me/settings/#profile", text: "Profile link and recovery" }));
    } else if (st.gone) {
      bar.className = "profile-bar is-gone";
      bar.replaceChildren(el("p", {}, el("b", { text: "This profile's link has stopped working." }),
        " If you asked for a new link, open the one in your newest email. Your missions are still on this device."),
        el("a", { href: "/me/settings/#profile", text: "Fix it in Settings" }));
    } else {
      bar.className = "profile-bar is-local";
      bar.replaceChildren(el("p", {}, el("b", { text: "Only on this device. " }),
        "Clearing your browser or a new phone would lose these. A free profile keeps them safe: no name, no password."),
        el("div", { class: "backup-row" }, el("button", { type: "button", class: "btn primary small", text: "Start a free profile", onclick: function () { P.offer(false); } }),
          el("a", { href: "/me/settings/#profile", text: "Already have one?" })));
    }
  }

  function refocus(id) { var e = document.getElementById(id); if (e) e.focus(); }

  draw();
  profileBar();
  window.addEventListener("amble:done", draw);
  window.addEventListener("amble:profile", function () {
    profileBar();
    // the Settings view redraws to show the new state, unless someone is typing there
    var a = document.activeElement;
    if (VIEW === "settings" && !(a && app.contains(a) && /INPUT|TEXTAREA/.test(a.tagName))) draw();
  });
  window.addEventListener("storage", function (e) { if (e.key === "amble.done") draw(); });
})();
