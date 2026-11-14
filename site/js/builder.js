/* The full mission builder (amblebee.com/suggest/mission/). Step by step, with tips, sent to AmbleBee Intake.

   Everything it offers comes from the server's GET /schema: the live packs, the allowed values, gear, theme chips,
   limits and the tips (amblebee-intake/app/tips.yaml), all read from this repo's own rules. The server checks the
   finished mission with the same checker as Mission Management, so what it accepts is a mission that would pass.
   Answers are saved in this browser as you go (amble.draft.mission) and cleared once sent. */
(function () {
  "use strict";
  var X = window.AmbleIntake;
  if (!X || !document.querySelector(".builder")) return;
  var el = X.el, $ = X.$, $$ = X.$$;
  var DRAFT = "amble.draft.mission";
  var box = $(".builder"), form = $(".builder-form", box), panel = $(".builder-panel", box);
  var stepsList = $(".builder-steps", box), status = $(".form-status", box);
  var back = $(".builder-back", box), next = $(".builder-next", box);
  var SC = null, couple = null;

  var S = X.load(DRAFT, null) || {};
  S.m = S.m || { mode: "", who: [], place: {}, steps: [], for_kids: { steps: [] }, season: [], gear: [], check_ahead: [], discounts: [], themes: [] };
  S.you = S.you || {};
  S.step = S.step || 0;
  S.seen = S.seen || 0;
  var errors = {};

  function persist() { X.save(DRAFT, S); }
  function packInfo() { return (SC.packs.filter(function (p) { return p.id === S.m.pack; })[0]) || { places: "optional" }; }
  function hasKids() { return S.m.mode !== "date" && (S.m.who || []).indexOf("kids") !== -1; }
  function label(group, v) { return (SC.labels[group] || {})[v] || v; }

  // ---------- small form pieces ----------
  function tip(key) { return SC.tips[key] ? el("p", { class: "tip" }, [el("span", { "aria-hidden": "true", text: "💡 " }), document.createTextNode(SC.tips[key])]) : null; }

  function field(key, labelText, control, opts) {
    opts = opts || {};
    var f = el("div", { class: "field", "data-field": key }, [
      el("label", { for: "b-" + key }, [document.createTextNode(labelText), opts.optional ? el("span", { class: "opt", text: " (optional)" }) : null]),
      control, opts.counter || null, tip(opts.tip || key)
    ]);
    if (errors[key]) f.append(el("p", { class: "err", id: "err-" + key, text: errors[key] }));
    return f;
  }

  function counter(input, max, aim) {
    var c = el("p", { class: "counter", "aria-live": "polite" });
    function upd() {
      var n = input.value.length;
      c.textContent = n + " / " + max + (aim && n < aim ? "  ·  aim for about " + aim : "");
      c.className = "counter" + (n > max ? " over" : "");
    }
    input.addEventListener("input", upd); upd();
    return c;
  }

  function text(key, value, max, set, opts) {
    opts = opts || {};
    var input = el(opts.area ? "textarea" : "input", { id: "b-" + key, type: opts.area ? null : (opts.type || "text"),
      rows: opts.area ? (opts.rows || 5) : null, placeholder: opts.placeholder || null, autocomplete: opts.autocomplete || null,
      "aria-invalid": errors[key] ? "true" : null, "aria-describedby": errors[key] ? "err-" + key : null });
    input.value = value || "";
    input.addEventListener("input", function () { set(input.value); persist(); });
    return { input: input, counter: max ? counter(input, max, opts.aim) : null };
  }

  function choices(name, values, group, current, multi, onChange) {
    var wrap = el("div", { class: multi ? "chips" : "modes", role: multi ? "group" : "radiogroup", id: "b-" + name });
    values.forEach(function (v) {
      var input = el("input", { type: multi ? "checkbox" : "radio", name: "b-" + name, value: v });
      input.checked = multi ? current.indexOf(v) !== -1 : current === v;
      input.addEventListener("change", function () {
        onChange(multi ? $$("input:checked", wrap).map(function (i) { return i.value; }) : v);
        persist();
      });
      wrap.append(el("label", {}, [input, el("span", { text: label(group, v) })]));
    });
    return wrap;
  }

  function lines(arr) { return (arr || []).join("\n"); }
  function toLines(v) { return v.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); }

  // ---------- the steps ----------
  var STEPS = [
    { id: "basics", title: "The basics", fields: ["pack", "name", "mode", "who"], render: function () {
      var sel = el("select", { id: "b-pack" }, [el("option", { value: "", text: "Not sure" })].concat(SC.packs.map(function (p) {
        return el("option", { value: p.id, text: p.name });
      })));
      sel.value = S.m.pack || "";
      sel.addEventListener("change", function () { S.m.pack = sel.value; persist(); });
      var name = text("name", S.m.name, SC.limits.name, function (v) { S.m.name = v; }, { placeholder: "Sunset at Pittock Mansion" });
      var out = [field("pack", "Pack", sel), field("name", "Mission name", name.input, { counter: name.counter }),
        field("mode", "Date or adventure?", choices("mode", SC.allowed.mode, "mode", S.m.mode, false, function (v) { S.m.mode = v; render(); }))];
      if (S.m.mode && S.m.mode !== "date") {
        out.push(field("who", "Who else can come?", choices("who", SC.allowed.who, "who", S.m.who || [], true, function (v) { S.m.who = v; }), { optional: true }));
      }
      return out;
    }, check: function () {
      var e = {};
      if (!String(S.m.name || "").trim()) e.name = "Give the mission a name.";
      if (!S.m.mode) e.mode = "Pick date, adventure, or both.";
      return e;
    } },

    { id: "place", title: "The place", fields: ["place_name", "area", "address", "coords", "website"], skip: function () { return packInfo().places === "none"; },
      render: function () {
        var p = S.m.place = S.m.place || {};
        var need = packInfo().places === "required";
        var n = text("place_name", p.name, 120, function (v) { p.name = v; }, { placeholder: "Haystack Rock" });
        var a = text("area", p.area, 120, function (v) { p.area = v; }, { placeholder: "Cannon Beach" });
        var ad = text("address", p.address, 200, function (v) { p.address = v; }, { placeholder: "Street address, if it has one" });
        var c = text("coords", p.coords, 0, function (v) { p.coords = v; }, { placeholder: "45.88456, -123.96875" });
        var w = text("website", p.website, 200, function (v) { p.website = v; }, { type: "url", placeholder: "https://" });
        return [
          need ? null : el("p", { class: "hint", text: "This one's optional: some missions work in lots of places." }),
          field("place_name", "Name of the place", n.input, { optional: !need, tip: "place_name" }),
          field("area", "Area", a.input, { optional: true }), field("address", "Address", ad.input, { optional: true }),
          field("coords", "Map pin", c.input, { optional: true }), field("website", "Website", w.input, { optional: true })
        ];
      }, check: function () {
        var e = {}, p = S.m.place || {};
        if (packInfo().places === "required" && !String(p.name || "").trim()) e.place_name = "Missions in this pack need a place. Its name is enough.";
        if (p.coords && !/^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(p.coords)) e.coords = "Paste it as two numbers, like 45.88456, -123.96875.";
        if (p.website && !/^https?:\/\//i.test(p.website)) e.website = "Start the website with https://";
        return e;
      } },

    { id: "mission", title: "The mission", fields: ["short", "description", "steps", "for_kids"], render: function () {
      var sh = text("short", S.m.short, SC.limits.short, function (v) { S.m.short = v; }, { placeholder: "Find three kinds of sea stars at low tide." });
      var d = text("description", S.m.description, SC.limits.description, function (v) { S.m.description = v; }, { area: true, rows: 6, aim: 400 });
      var st = text("steps", lines(S.m.steps), 0, function (v) { S.m.steps = toLines(v); }, { area: true, rows: 4, placeholder: "A selfie with the rock behind you" });
      var out = [field("short", "One line for the camera screen", sh.input, { counter: sh.counter }),
        field("description", "The mission", d.input, { counter: d.counter }),
        field("steps", "Photo prompts", st.input, { optional: true })];
      if (hasKids()) {
        var fk = S.m.for_kids = S.m.for_kids || { steps: [] };
        var ks = text("for_kids", fk.short, 200, function (v) { fk.short = v; }, { placeholder: "Find a crab hiding in the rocks!" });
        var kst = text("kids_steps", lines(fk.steps), 0, function (v) { fk.steps = toLines(v); }, { area: true, rows: 3, placeholder: "Something orange" });
        out.push(el("h3", { class: "builder-sub", text: "The kids' version" }),
          field("for_kids", "One simple sentence for kids", ks.input, { tip: "kids_short" }),
          field("kids_steps", "Things for kids to spot", kst.input, { tip: "kids_steps" }));
      }
      return out;
    }, check: function () {
      var e = {}, desc = String(S.m.description || "");
      if (!String(S.m.short || "").trim()) e.short = "Write one line for the camera screen.";
      else if (S.m.short.length > SC.limits.short) e.short = "Keep it to " + SC.limits.short + " characters.";
      if (desc.trim().length < 40) e.description = "Write a few sentences: what to do, and the photo to take.";
      else if (desc.length > SC.limits.description) e.description = "Keep it to " + SC.limits.description + " characters.";
      else if (couple && (S.m.who || []).length && S.m.mode !== "date" && couple.test(desc)) {
        e.description = "Friends, family or one person can go on this one, so skip words like \"" + desc.match(couple)[0] + "\". Try \"you\" or \"your group\".";
      }
      if (hasKids()) {
        var fk = S.m.for_kids || {};
        if (!String(fk.short || "").trim() || !(fk.steps || []).length) e.for_kids = "Kids can come, so add a kids' sentence and at least one thing to spot.";
      }
      return e;
    } },

    { id: "details", title: "Details", fields: ["duration", "effort", "cost", "setting", "season", "time_of_day", "travel", "gear", "check_ahead", "discounts", "caution"],
      render: function () {
        function one(key, title, def) {
          if (!S.m[key] && def) S.m[key] = def;
          return field(key, title, choices(key, SC.allowed[key], key, S.m[key], false, function (v) { S.m[key] = v; }));
        }
        var any = el("input", { type: "checkbox", id: "b-season-any" });
        any.checked = !(S.m.season || []).length;
        var seasons = choices("season", SC.allowed.season, "season", S.m.season || [], true, function (v) {
          S.m.season = v.length === 4 ? [] : v; any.checked = !S.m.season.length;
        });
        any.addEventListener("change", function () { if (any.checked) { S.m.season = []; $$("input", seasons).forEach(function (i) { i.checked = false; }); persist(); } });
        var seasonBox = el("div", {}, [el("div", { class: "chips" }, [el("label", {}, [any, el("span", { text: "Any time of year" })])]), seasons]);
        var gear = el("div", { class: "gear-list", id: "b-gear" });
        function drawGear() {
          gear.textContent = "";
          var picked = {};
          (S.m.gear || []).forEach(function (g) { picked[g.item] = g; });
          var chips = choices("gear-items", SC.gear, "gear", Object.keys(picked), true, function (items) {
            S.m.gear = items.map(function (i) { return picked[i] || { item: i, rent: "no" }; }); drawGear();
          });
          $$("span", chips).forEach(function (sp) { sp.textContent = sp.textContent.replace(/-/g, " "); });
          gear.append(chips);
          (S.m.gear || []).forEach(function (g) {
            var sel = el("select", { "aria-label": "Can people rent " + g.item.replace(/-/g, " ") + "?" }, SC.rent.map(function (r) {
              return el("option", { value: r, text: label("rent", r) });
            }));
            sel.value = g.rent || "no";
            sel.addEventListener("change", function () { g.rent = sel.value; persist(); });
            gear.append(el("div", { class: "gear-row" }, [el("b", { text: g.item.replace(/-/g, " ") }), sel]));
          });
        }
        drawGear();
        var ca = text("caution", S.m.caution, SC.limits.caution, function (v) { S.m.caution = v; }, { placeholder: "No cell service past the trailhead." });
        return [one("duration", "How long", "short"), one("effort", "How hard", "easy"), one("cost", "Cost for two", "$"),
          one("setting", "Indoors or out", "either"), field("season", "When in the year", seasonBox),
          one("time_of_day", "Best time of day", "any"), one("travel", "How far", "local"),
          field("gear", "Gear it really needs", gear, { optional: true }),
          field("check_ahead", "Check before going", choices("check_ahead", SC.allowed.check_ahead, "check_ahead", S.m.check_ahead || [], true, function (v) { S.m.check_ahead = v; }), { optional: true }),
          field("discounts", "Discounts it offers", choices("discounts", SC.allowed.discounts, "discounts", S.m.discounts || [], true, function (v) { S.m.discounts = v; }), { optional: true }),
          field("caution", "A warning", ca.input, { optional: true, counter: ca.counter })];
      }, check: function () {
        var e = {};
        if (S.m.caution && S.m.caution.length > SC.limits.caution) e.caution = "Keep it to " + SC.limits.caution + " characters.";
        return e;
      } },

    { id: "themes", title: "Themes", fields: ["themes"], render: function () {
      var picked = S.m.themes || [];
      var wrap = el("div", { id: "b-themes" });
      var count = el("p", { class: "counter" });
      function sync() {
        count.textContent = picked.length + " of " + SC.themes_max + " picked";
        $$("input", wrap).forEach(function (i) { i.disabled = !i.checked && picked.length >= SC.themes_max; });
      }
      Object.keys(SC.theme_groups).forEach(function (g) {
        var chips = el("div", { class: "chips themes" });
        SC.theme_groups[g].forEach(function (t) {
          var input = el("input", { type: "checkbox", value: t });
          input.checked = picked.indexOf(t) !== -1;
          input.addEventListener("change", function () {
            picked = $$("input:checked", wrap).map(function (i) { return i.value; });
            S.m.themes = picked; sync(); persist();
          });
          chips.append(el("label", {}, [input, el("span", { text: SC.themes[t] })]));
        });
        wrap.append(el("p", { class: "theme-group", text: g }), chips);
      });
      sync();
      return [field("themes", "Pick up to " + SC.themes_max, wrap, { counter: count })];
    }, check: function () {
      var e = {};
      if ((S.m.themes || []).indexOf("drinks") !== -1 && hasKids()) e.themes = "Kids can come on this one, so leave out Wine, beer & cocktails.";
      if ((S.m.themes || []).indexOf("romantic") !== -1 && S.m.mode === "adventure") e.themes = "Romantic is for dates; this one's an adventure.";
      return e;
    } },

    { id: "about", title: "About the place", fields: ["about"], render: function () {
      var ab = text("about", S.m.about, SC.limits.about, function (v) { S.m.about = v; }, { area: true, rows: 7 });
      return [field("about", "About this place", ab.input, { optional: true, counter: ab.counter })];
    }, check: function () {
      return S.m.about && S.m.about.length > SC.limits.about ? { about: "Keep it to " + SC.limits.about + " characters." } : {};
    } },

    { id: "you", title: "About you", fields: ["you_name", "email"], render: function () {
      var n = text("you_name", S.you.you_name, SC.limits.credit, function (v) { S.you.you_name = v; }, { autocomplete: "name", placeholder: "Max W." });
      X.tidyName(n.input);
      var credit = el("input", { type: "checkbox", id: "b-credit" });
      credit.checked = !!S.you.credit;
      credit.addEventListener("change", function () { S.you.credit = credit.checked; persist(); });
      var em = text("email", S.you.email, 254, function (v) { S.you.email = v; }, { type: "email", autocomplete: "email" });
      var nameField = field("you_name", "Your name", n.input, { optional: true });
      nameField.append(el("label", { class: "check" }, [credit, el("span", { text: "Credit me on the mission (\"Suggested by …\")" })]));
      return [nameField, field("email", "Email", em.input, { optional: true }),
        el("p", { class: "hint" }, [document.createTextNode("We only use your email for updates about this mission, and your name only appears on it if you ask. "),
          el("a", { href: "/privacy/#forms", text: "Privacy" })])];
    }, check: function () {
      var e = {};
      if (S.you.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(S.you.email)) e.email = "That email doesn't look quite right.";
      return e;
    } },

    { id: "review", title: "Review", fields: [], render: function () {
      var m = S.m, out = [el("p", { text: "Here's your mission. Edit any part, then send it." })];
      function row(t, v) { return v ? el("div", { class: "review-row" }, [el("dt", { text: t }), el("dd", { text: v })]) : null; }
      function list(group, arr) { return (arr || []).map(function (v) { return label(group, v); }).join(", "); }
      STEPS.forEach(function (st, i) {
        if (st.id === "review" || (st.skip && st.skip())) return;
        var rows = [];
        if (st.id === "basics") rows = [row("Pack", m.pack ? packInfo().name : "Not sure"), row("Name", m.name), row("Type", label("mode", m.mode)), row("Who else", list("who", m.who))];
        if (st.id === "place") rows = [row("Place", (m.place || {}).name), row("Area", (m.place || {}).area), row("Address", (m.place || {}).address), row("Map pin", (m.place || {}).coords), row("Website", (m.place || {}).website)];
        if (st.id === "mission") rows = [row("Camera line", m.short), row("Mission", m.description), row("Photo prompts", (m.steps || []).join(" · ")),
          hasKids() ? row("For kids", ((m.for_kids || {}).short || "") + " " + ((m.for_kids || {}).steps || []).join(" · ")) : null];
        if (st.id === "details") rows = [row("How long", label("duration", m.duration)), row("Effort", label("effort", m.effort)), row("Cost", label("cost", m.cost)),
          row("Setting", label("setting", m.setting)), row("Seasons", (m.season || []).length ? list("season", m.season) : "Any time of year"),
          row("Time of day", label("time_of_day", m.time_of_day)), row("Travel", label("travel", m.travel)),
          row("Gear", (m.gear || []).map(function (g) { return g.item.replace(/-/g, " ") + " (" + label("rent", g.rent) + ")"; }).join(", ")),
          row("Check ahead", list("check_ahead", m.check_ahead)), row("Discounts", list("discounts", m.discounts)), row("Warning", m.caution)];
        if (st.id === "themes") rows = [row("Themes", (m.themes || []).map(function (t) { return SC.themes[t]; }).join(", "))];
        if (st.id === "about") rows = [row("About", m.about)];
        if (st.id === "you") rows = [row("Name", (S.you.you_name || "") + (S.you.credit && S.you.you_name ? " (credited)" : "")), row("Email", S.you.email)];
        var edit = el("button", { type: "button", class: "linkish", text: "Edit" });
        edit.addEventListener("click", function () { go(i); });
        out.push(el("section", { class: "review-part" }, [el("h3", {}, [document.createTextNode(st.title + " "), edit]),
          el("dl", {}, rows.filter(Boolean).length ? rows.filter(Boolean) : [el("p", { class: "hint", text: "Nothing added." })])]));
      });
      if (S.you.email) out.push(X.spamNote(S.you.email, true));
      return out;
    } }
  ];

  function visibleSteps() { return STEPS.map(function (s, i) { return i; }).filter(function (i) { return !(STEPS[i].skip && STEPS[i].skip()); }); }

  function render(focus) {
    var vis = visibleSteps();
    if (vis.indexOf(S.step) === -1) S.step = vis[0];
    var st = STEPS[S.step], pos = vis.indexOf(S.step);
    stepsList.textContent = "";
    vis.forEach(function (i, n) {
      var reachable = i <= S.seen;
      var b = el("button", { type: "button", class: "step" + (i === S.step ? " now" : i < S.step ? " done" : ""), disabled: reachable ? null : "",
        "aria-current": i === S.step ? "step" : null }, [el("span", { class: "n", text: String(n + 1) }), el("span", { class: "t", text: STEPS[i].title })]);
      b.addEventListener("click", function () { go(i); });
      stepsList.append(el("li", {}, [b]));
    });
    panel.textContent = "";
    panel.append(el("h2", { text: (pos + 1) + ". " + st.title }));
    st.render().forEach(function (n) { if (n) panel.append(n); });
    back.style.visibility = pos === 0 ? "hidden" : "";   // .btn sets display, which beats the hidden attribute
    next.textContent = st.id === "review" ? "Send my mission" : "Next";
    next.className = "btn primary builder-next";
    if (focus) panel.focus();
    persist();
  }

  function go(i) {
    errors = {}; status.textContent = ""; status.className = "form-status";
    S.step = i; S.seen = Math.max(S.seen, i);
    render(true);
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function showErrors(e) {
    errors = e;
    render(false);
    var first = $(".field .err", panel);
    if (first) { var f = first.closest(".field"); var inp = $("input, textarea, select", f); if (inp) inp.focus(); }
  }

  back.addEventListener("click", function () { var vis = visibleSteps(); go(vis[Math.max(0, vis.indexOf(S.step) - 1)]); });
  next.addEventListener("click", function () {
    var st = STEPS[S.step], e = st.check ? st.check() : {};
    if (Object.keys(e).length) return showErrors(e);
    if (st.id !== "review") { var vis = visibleSteps(); return go(vis[vis.indexOf(S.step) + 1]); }
    send();
  });

  function send() {
    next.disabled = true; next.textContent = "Sending…";
    status.textContent = ""; status.className = "form-status";
    var m = JSON.parse(JSON.stringify(S.m));
    if (!m.season || !m.season.length) m.season = "any";
    var body = { mission: m, you_name: S.you.you_name || "", credit: !!S.you.credit, email: S.you.email || "",
      website: $("#b-website").value, elapsed_ms: Date.now() - X.started };
    X.request("/submit/mission", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 201 && r.body.ok) {
          X.save(DRAFT, null);
          X.track("mission_sent");
          var done = $(".intake-done", box);
          done.textContent = "";
          done.append(el("h2", { text: "Thank you! Your mission is in." }),
            el("p", { text: "Since you built the whole thing, all that's left for us is to check it. You can follow it from \"Received\" all the way to \"Live\"." }));
          if (S.you.email) done.append(X.spamNote(S.you.email));
          if (r.body.status_url) done.append(X.linkPanel(r.body.status_url, "mission", S.m.name));
          S = { m: {}, you: {}, step: 0, seen: 0 };
          form.hidden = true; done.hidden = false; done.focus();
          X.renderMine();
          return;
        }
        if (r.status === 400 && r.body.errors) {
          var where = STEPS.map(function (s, i) { return i; }).filter(function (i) {
            return STEPS[i].fields.some(function (f) { return r.body.errors[f]; }) || (i === 1 && r.body.errors.place_name);
          })[0];
          if (r.body.errors.general) status.textContent = r.body.errors.general;
          if (where !== undefined) { S.step = where; return showErrors(r.body.errors); }
        }
        status.textContent = r.body.error || "Something went wrong. Please try again.";
        status.className = "form-status bad";
      })
      .catch(function () {
        status.textContent = "We couldn't reach the AmbleBee mailbox. Everything is saved here, so try again in a minute.";
        status.className = "form-status bad";
      })
      .then(function () { next.disabled = false; if (STEPS[S.step] && STEPS[S.step].id === "review") next.textContent = "Send my mission"; });
  }

  // ---------- start: is the mailbox open, and what can be built? ----------
  function start() {
    var wait = $(".intake-wait", box), down = $(".intake-down", box), backup = $(".intake-backup", box);
    wait.hidden = false; down.hidden = true; backup.hidden = true;
    X.health().then(function (state) {
      if (state === "down") { wait.hidden = true; $("a.backup-link", backup).href = X.BACKUP.idea; backup.hidden = false; return; }
      if (state === "paused") { wait.hidden = true; down.hidden = false; return; }
      return X.request("/schema", {}, 8000).then(function (r) {
        wait.hidden = true;
        if (r.status !== 200 || !r.body.ok) { down.hidden = false; return; }
        SC = r.body;
        try { couple = new RegExp(SC.couple_words, "i"); } catch (e) { couple = null; }
        form.hidden = false;
        render(false);
      });
    }).catch(function () { wait.hidden = true; down.hidden = false; });
  }
  $(".backup-retry", box).addEventListener("click", start);
  start();
})();
