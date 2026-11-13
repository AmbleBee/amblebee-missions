/* AmbleBee Intake: the Suggest, Report, Contact and Status pages talk to the AmbleBee Intake server
   (github.com/AmbleBee/amblebee-intake, running on our own server). Loaded only by those pages.

   - Before showing a form, it asks the server whether it's up. No answer = "not accepting right now",
     so nobody types into a form that can't be sent.
   - What you type is saved in this browser as you go, so a failed send never loses it. It's cleared once sent.
   - Status links you get are saved in this browser under "Your submissions". Nothing else is kept. */
(function () {
  "use strict";

  var API = "https://amblebee-intake.tail58116.ts.net";   // also in connect-src in tools/build_pages.py
  // Backups for when our server can't be reached: the old Google Forms. Slower for us to see, and no status link.
  // (Not used when intake is paused on purpose: then the forms just say they're closed.)
  var BACKUP = {
    idea: "https://forms.gle/V8UZRwmDrLwzQpuM6",
    report: "https://docs.google.com/forms/d/e/1FAIpQLSesllGRZbJaA4nINHJnwgmJxMIFX4z1aI88puOSOCUmzrnfHQ/viewform"
  };
  var REPORT_FIELDS = { id: "entry.872618061", name: "entry.160884926" };   // pre-fills the backup report form
  var LIST_KEY = "amble.submissions";
  var DRAFT_KEY = "amble.draft.";
  var KIND = { idea: "Mission idea", mission: "Mission", report: "Problem report", contact: "Message" };
  var started = Date.now();

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage blocked: fine */ }
  }
  function track(name) { if (window.ambleTrack) window.ambleTrack(name); }

  function request(path, options, ms) {
    var ctl = "AbortController" in window ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 15000) : null;
    var opts = Object.assign({ cache: "no-store", credentials: "omit" }, options || {});
    if (ctl) opts.signal = ctl.signal;
    return fetch(API + path, opts).then(function (r) {
      clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (body) { return { status: r.status, body: body }; });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  // "up", "paused" (the server answered but isn't taking submissions) or "down" (no answer)
  function health() {
    return request("/health", {}, 3500).then(function (r) {
      if (r.status === 200 && r.body.ok) return r.body.accepting ? "up" : "paused";
      return "down";
    }, function () { return "down"; });
  }

  function backupUrl(kind, form) {
    if (!BACKUP[kind]) return null;
    if (kind !== "report") return BACKUP[kind];
    var q = new URLSearchParams({ usp: "pp_url" });
    var id = form.elements.mission_id.value, name = form.elements.mission_name.value;
    if (id) q.set(REPORT_FIELDS.id, id);
    if (name) q.set(REPORT_FIELDS.name, name);
    return BACKUP.report + "?" + q;
  }

  // ---------- your submissions (status links kept in this browser) ----------
  function mine() { return load(LIST_KEY, []).filter(function (x) { return x && x.token; }); }
  function remember(item) {
    var list = mine().filter(function (x) { return x.token !== item.token; });
    list.unshift(item);
    save(LIST_KEY, list.slice(0, 30));
  }
  function forget(token) { save(LIST_KEY, mine().filter(function (x) { return x.token !== token; })); }

  function renderMine() {
    var box = $(".intake-mine");
    if (!box) return;
    var list = mine(), ul = $("ul", box);
    ul.textContent = "";
    box.hidden = !list.length;
    list.forEach(function (x) {
      var forgetBtn = el("button", { type: "button", class: "linkish", "aria-label": "Forget " + x.title, text: "Forget" });
      forgetBtn.addEventListener("click", function () { forget(x.token); renderMine(); });
      ul.append(el("li", {}, [
        el("a", { href: "/status/#" + x.token, text: x.title || "Your submission" }),
        el("small", { text: (KIND[x.kind] || "Submission") + (x.at ? " · " + new Date(x.at).toLocaleDateString() : "") }),
        forgetBtn
      ]));
    });
  }

  // ---------- names ----------
  // Names are kept as a first name and last initial: "max westlie" becomes "Max W.". A first name alone is left as it is.
  function shortName(value) {
    var words = String(value || "").trim().split(/\s+/).filter(Boolean).map(function (w) {
      return w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    });
    if (words.length < 2) return words.join("");
    var last = words.pop().replace(/\.+$/, "");
    return words.join(" ") + (last ? " " + last.charAt(0).toUpperCase() + "." : "");
  }
  function tidyName(input) {
    input.addEventListener("blur", function () {
      var short = shortName(input.value);
      if (short !== input.value) { input.value = short; input.dispatchEvent(new Event("input", { bubbles: true })); }
    });
  }

  // ---------- forms ----------
  function fields(form) {
    var data = {};
    $$("input, textarea, select", form).forEach(function (f) {
      if (!f.name) return;
      data[f.name] = f.type === "checkbox" ? f.checked : f.value;
    });
    return data;
  }

  function restoreDraft(form, kind) {
    var draft = load(DRAFT_KEY + kind, null);
    if (!draft) return;
    $$("input, textarea", form).forEach(function (f) {
      if (!f.name || f.name === "website" || f.type === "hidden" || !(f.name in draft)) return;
      if (f.readOnly) return;
      if (f.type === "checkbox") f.checked = !!draft[f.name]; else if (!f.value) f.value = draft[f.name];
    });
  }

  function showErrors(form, errors) {
    $$(".err", form).forEach(function (n) { n.remove(); });
    $$("[aria-invalid]", form).forEach(function (n) { n.removeAttribute("aria-invalid"); });
    var first = null;
    Object.keys(errors || {}).forEach(function (name) {
      var input = form.elements[name];
      if (!input) return;
      var id = "err-" + name;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", ((input.getAttribute("aria-describedby") || "").replace(id, "") + " " + id).trim());
      input.closest(".field").append(el("p", { class: "err", id: id, text: errors[name] }));
      first = first || input;
    });
    if (first) first.focus();
  }

  function linkPanel(url, kind, title) {
    var token = url.split("#")[1];
    remember({ token: token, title: title, kind: kind, at: new Date().toISOString() });
    var input = el("input", { type: "text", readonly: "", value: url, "aria-label": "Your private status link", class: "link-box" });
    var copy = el("button", { type: "button", class: "btn small", text: "Copy link" });
    copy.addEventListener("click", function () {
      input.select();
      var done = function () { copy.textContent = "Copied!"; setTimeout(function () { copy.textContent = "Copy link"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { document.execCommand("copy"); done(); });
      else { document.execCommand("copy"); done(); }
    });
    return el("div", { class: "link-panel" }, [
      el("p", { class: "link-label", text: "Your private status link" }),
      el("div", { class: "link-row" }, [input, copy]),
      el("p", { class: "hint", text: "This link is the only way to check on it without email, so keep it somewhere safe. It's saved on this device too, under Your submissions." }),
      el("p", {}, [el("a", { class: "btn primary small", href: "/status/#" + token, text: "Check the status" })])
    ]);
  }

  // "We sent an email to …": only when an email really goes out (ideas and missions with an email; reports only
  // when they asked to follow). Gmail and others sometimes file a brand-new sender as spam, so say where to look.
  function spamNote(email, future) {
    return el("p", { class: "spam-note" }, [
      document.createTextNode((future ? "We'll email " : "We sent an email to ")),
      el("b", { text: email }),
      document.createTextNode(" with updates. If you don't see it, please check your spam folder.")
    ]);
  }

  var THANKS = {
    idea: ["Thank you! Your idea is in.", "Every suggestion gets read. You can follow it from \"Awaiting review\" all the way to \"Live\"."],
    report: ["Thank you for the report!", "We'll take a look and fix what needs fixing."],
    contact: ["Thanks! Your message is on its way.", "We read every message, usually within a few days. Our reply shows up on your private page below, and we'll email you when it does."]
  };

  function setup(box) {
    var kind = box.getAttribute("data-intake");
    var form = $("form", box), wait = $(".intake-wait", box), down = $(".intake-down", box), done = $(".intake-done", box);
    var status = $(".form-status", form);
    restoreDraft(form, kind);
    var nameInput = $('input[name="name"]', form);
    if (nameInput) tidyName(nameInput);
    if (kind === "report") prefillReport(form);

    form.addEventListener("input", function () {
      var d = fields(form); delete d.website;
      save(DRAFT_KEY + kind, d);
    });

    var backup = $(".intake-backup", box);
    function check() {
      wait.hidden = false; down.hidden = true; if (backup) backup.hidden = true;
      health().then(function (state) {
        wait.hidden = true;
        if (state === "up") { form.hidden = false; return; }
        var url = state === "down" && backup ? backupUrl(kind, form) : null;
        if (url) {
          $("a.backup-link", backup).href = url;
          backup.hidden = false;
        } else down.hidden = false;
      });
    }
    if (backup) $(".backup-retry", backup).addEventListener("click", function () { form.hidden = true; check(); });
    check();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $("button[type=submit]", form);
      var data = fields(form);
      data.elapsed_ms = Date.now() - started;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = "Sending…";
      status.textContent = "";
      status.className = "form-status";
      var path = kind === "idea" ? "/submit/idea" : "/" + kind;
      request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
        .then(function (r) {
          if (r.status === 201 && r.body.ok) {
            save(DRAFT_KEY + kind, null);
            form.reset();   // Firefox refills fields on reload from what's in them, so empty them once sent
            track(kind + "_sent");
            var title = kind === "report" ? (data.mission_name || data.mission_id) : (kind === "contact" ? "Your message to AmbleBee" : data.title);
            done.textContent = "";
            done.append(el("h2", { text: THANKS[kind][0] }), el("p", { text: THANKS[kind][1] }));
            var mailed = String(data.email || "").trim();
            if (mailed && (kind === "idea" || kind === "contact" || (kind === "report" && data.follow))) done.append(spamNote(mailed));
            if (r.body.status_url) done.append(linkPanel(r.body.status_url, kind, title));
            form.hidden = true;
            done.hidden = false;
            done.focus();
            renderMine();
            return;
          }
          if (r.status === 400 && r.body.errors) showErrors(form, r.body.errors);
          status.textContent = r.body.error || "Something went wrong. Please try again.";
          status.className = "form-status bad";
        })
        .catch(function () {
          status.textContent = "We couldn't reach the AmbleBee mailbox. Everything you typed is still here, so try again in a minute.";
          status.className = "form-status bad";
          var url = backupUrl(kind, form);
          if (url) {
            status.append(" Or ", el("a", { href: url, target: "_blank", rel: "noopener", text: "use our backup form" }),
              " (slower, and no status link).");
          }
        })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    });
  }

  // "Report a problem" on a mission opens /report/?id=<mission id>&name=<mission name>
  function prefillReport(form) {
    var q = new URLSearchParams(location.search);
    var id = (q.get("id") || "").trim().toLowerCase(), name = (q.get("name") || "").trim().slice(0, 120);
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) return;
    form.elements.mission_id.value = id;
    var nameInput = form.elements.mission_name;
    nameInput.value = name || id;
    nameInput.readOnly = true;
    var about = $(".report-about", form);
    if (about) {
      about.hidden = false;
      $("a", about).href = "/missions/" + encodeURIComponent(id) + "/";
      $("a", about).textContent = name || id;
      nameInput.closest(".field").hidden = true;
    }
  }

  // ---------- status page ----------
  function when(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }); }
    catch (e) { return ""; }
  }

  // "We have a question": the question, when to answer by, and a box to answer in. The answer goes to
  // POST /status/<token>/reply, and the suggestion carries on from where it was.
  var justAnswered = false;
  function answerForm(token, v) {
    var area = el("textarea", { id: "status-answer", rows: "5", maxlength: "3000", required: "" });
    var note = el("p", { class: "form-status", role: "status", "aria-live": "polite" });
    var chat = !!v.thread;   // a contact conversation, not a question about a suggestion
    var send = el("button", { class: "btn primary", type: "submit", text: chat ? "Send reply" : "Send my answer" });
    var form = el("form", { class: "intake-form status-answer", novalidate: "" }, [
      chat ? null : el("p", { class: "status-question", text: v.question }),
      v.due ? el("p", { class: "hint", text: chat
        ? "This conversation closes on " + when(v.due) + " if there's no reply. Each reply keeps it open another " + (v.days || 30) + " days."
        : "Please answer by " + when(v.due) + ". After that we'll close it for now." }) : null,
      chat ? el("p", { class: "hint", text: "Please reply here, not by email. Email replies can get lost." }) : null,
      el("div", { class: "field" }, [el("label", { for: "status-answer", text: chat ? "Your reply" : "Your answer" }), area]),
      send, note
    ]);
    function bad(text) {
      send.disabled = false;
      note.className = "form-status bad";
      note.textContent = text;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = area.value.trim();
      if (!text) { area.setAttribute("aria-invalid", "true"); bad(chat ? "Write your reply first." : "Write your answer first."); area.focus(); return; }
      area.removeAttribute("aria-invalid");
      send.disabled = true;
      note.className = "form-status";
      note.textContent = "Sending…";
      request("/status/" + encodeURIComponent(token) + "/reply",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) })
        .then(function (r) {
          if (r.status === 201 && r.body.ok) { track("answer_sent"); justAnswered = true; showStatus(); return; }
          bad((r.body.errors && r.body.errors.message) || r.body.error || "That didn't send. Please try again.");
        }, function () { bad("We couldn't reach AmbleBee just now. Your answer is still here, so please try again in a minute."); });
    });
    return form;
  }

  // Closing a contact conversation: the button on this page, or the Close button in an email. The email one
  // lands here with "&close" on the link and asks first, so nothing closes just because a link was opened.
  var justClosed = false;
  function plainLink(token) {
    try { history.replaceState(null, "", location.pathname + "#" + token); } catch (e) { /* fine: the next load just asks again */ }
  }
  function closeIt(token, button, note) {
    button.disabled = true;
    request("/status/" + encodeURIComponent(token) + "/close",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (r) {
        if (r.status === 200 && r.body.ok) { track("conversation_closed"); justClosed = true; plainLink(token); showStatus(); return; }
        button.disabled = false;
        if (note) { note.className = "form-status bad"; note.textContent = r.body.error || "That didn't work. Please try again."; }
      }, function () {
        button.disabled = false;
        if (note) { note.className = "form-status bad"; note.textContent = "We couldn't reach AmbleBee just now. Please try again in a minute."; }
      });
  }
  function closeAsk(token) {
    var yes = el("button", { class: "btn primary small", type: "button", text: "Yes, close it" });
    var no = el("button", { class: "btn small", type: "button", text: "Keep it open" });
    var note = el("p", { class: "form-status", role: "status", "aria-live": "polite" });
    var box = el("div", { class: "status-closeask", role: "group", "aria-label": "Close this conversation?" }, [
      el("p", { class: "status-closeask-title", text: "Close this conversation?" }),
      el("p", { text: "Closing lets us know you're all set. You can still reply later and it opens again." }),
      el("p", { class: "status-closeask-actions" }, [yes, no]), note
    ]);
    yes.addEventListener("click", function () { closeIt(token, yes, note); });
    no.addEventListener("click", function () { plainLink(token); showStatus(); });
    return box;
  }

  function showStatus(view) {
    var out = $(".status-view");
    var lookup = $(".status-lookup");
    // "#<token>" or, from the Close button in an email, "#<token>&close"
    var parts = location.hash.replace(/^#/, "").split("&");
    var token = parts[0];
    var wantsClose = parts.indexOf("close") > 0;
    out.textContent = "";
    if (!token) { out.hidden = true; lookup.hidden = false; return; }
    lookup.hidden = true;
    out.hidden = false;
    out.append(el("p", { class: "hand", text: "Looking it up…" }));
    request("/status/" + encodeURIComponent(token), {}, 8000).then(function (r) {
      out.textContent = "";
      if (r.status === 404) {
        out.append(el("h2", { text: "We couldn't find that link" }),
          el("p", { text: "Check that the whole link was copied, including everything after the #." }));
        lookup.hidden = false;
        return;
      }
      if (r.status !== 200 || !r.body.ok) throw new Error("bad");
      var v = r.body;
      var stepIdx = v.steps.map(function (s) { return s.status; }).indexOf(v.status);
      var steps = el("ol", { class: "steps", "aria-label": "Progress" }, v.steps.map(function (s, i) {
        var state = stepIdx === -1 ? "" : (i < stepIdx ? "done" : (i === stepIdx ? "now" : ""));
        return el("li", { class: state, "aria-current": state === "now" ? "step" : null }, [el("span", { text: s.label })]);
      }));
      var card = el("div", { class: "status-card" + (v.status === "declined" || v.status === "no_change" ? " muted" : "") }, [
        el("p", { class: "status-kind", text: (KIND[v.kind] || "Submission") + " · sent " + when(v.created_at) }),
        el("h2", { text: v.title }),
        el("p", { class: "status-headline", text: v.headline }),
        el("p", { text: v.text })
      ]);
      if (justClosed) {
        justClosed = false;
        card.append(el("p", { class: "status-thanks", role: "status", text: "Closed. Thanks for letting us know!" }));
      }
      if (v.thread && wantsClose && v.can_close) card.append(closeAsk(token));
      if (justAnswered) {
        justAnswered = false;
        card.append(el("p", { class: "status-thanks", role: "status", text: v.thread ? "Sent! We'll read it soon." : "Thank you! Your answer is in, and your suggestion is moving again." }));
      }
      if (v.thread) {
        card.append(el("ol", { class: "status-thread", "aria-label": "Conversation" }, v.thread.map(function (m) {
          return el("li", { class: m.who === "us" ? "us" : "you" }, [
            el("span", { class: "who", text: (m.who === "us" ? "AmbleBee" : "You") + " · " + when(m.at) }),
            el("p", { text: m.body })
          ]);
        })));
        if (v.can_reply) card.append(answerForm(token, v));
        if (v.can_close && !wantsClose) {
          var shut = el("button", { class: "btn small", type: "button", text: "Close this conversation" });
          shut.addEventListener("click", function () { closeIt(token, shut); });
          card.append(el("p", { class: "status-close" }, [el("span", { text: "All sorted? " }), shut]));
        }
      } else if (v.status === "needs_info" && v.question) card.append(answerForm(token, v));
      if (v.reason) card.append(el("p", { class: "status-reason", text: v.reason }));
      if (v.mission_url) card.append(el("p", {}, [el("a", { class: "btn primary small", href: v.mission_url, text: "See the mission" })]));
      out.append(card);
      if (stepIdx !== -1) out.append(steps);
      if (v.history && v.history.length) {
        out.append(el("h3", { text: "History" }),
          el("ul", { class: "status-history" }, v.history.map(function (x) {
            return el("li", {}, [el("b", { text: x.label }), document.createTextNode(" · " + when(x.at))]);
          })));
      }
      if (!mine().some(function (x) { return x.token === token; })) {
        var keep = el("button", { type: "button", class: "btn small", text: "Save to Your submissions" });
        keep.addEventListener("click", function () {
          remember({ token: token, title: v.title, kind: v.kind, at: v.created_at });
          keep.replaceWith(el("p", { class: "hint", text: "Saved on this device." }));
          renderMine();
        });
        out.append(keep);
      }
    }).catch(function () {
      out.textContent = "";
      out.append(el("h2", { text: "Status lookup is down right now" }),
        el("p", { text: "Your link still works. Please check back a little later." }));
    });
  }

  function setupStatus() {
    var form = $(".status-lookup form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var raw = form.elements.link.value.trim();
      var token = (raw.indexOf("#") !== -1 ? raw.split("#").pop() : raw).split("&")[0];
      if (token) location.hash = token;
    });
    window.addEventListener("hashchange", showStatus);
    showStatus();
  }

  // shared with site/js/builder.js (the full mission builder)
  window.AmbleIntake = { API: API, BACKUP: BACKUP, request: request, health: health, el: el, $: $, $$: $$, load: load,
    save: save, track: track, linkPanel: linkPanel, renderMine: renderMine, spamNote: spamNote, started: started, shortName: shortName, tidyName: tidyName };

  $$(".intake[data-intake]").forEach(setup);
  if ($(".status-view")) setupStatus();
  renderMine();
})();
