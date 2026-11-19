/* Plans (claude/calendar-voting-PLAN.md, branch 1): "Add to calendar" on every mission, My plans (/me/plans/) and the
   Coming up preview on Your profile.

   One button covers every calendar: it opens "Plan this mission" (day, optional start time, length, reminder) with
   Google Calendar, Outlook (personal, or work and school) and a .ics file for Apple and everything else. Whichever is
   tapped, the mission and day are saved as a plan (site/js/done.js keeps it, and the profile syncs it), so "Did you go?"
   can ask after the day and the Planned Ahead stamp can find it.

   Nothing leaves this browser until Google or Outlook is tapped, and then only that one event goes to them. The .ics
   file is made here and never sent anywhere.

   window.AmblePlans: { button(m), open(m, opts), event(m, plan), googleUrl(ev), outlookUrl(ev, work), ics(ev) }
   m is a mission as in catalog.json: { full_id, id, name, short, season, duration, gear, place } */
(function () {
  "use strict";
  var U = window.AmbleUtil, el = U.el, pad = U.pad, ymd = U.ymd, today = U.today;

  var SITE = "https://amblebee.com";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var SEASON_OF_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];
  var HOURS = { short: 2, "half-day": 4, "all-day": 8 };   // mission duration → event length, when a start time is picked
  var LENGTHS = [1, 2, 3, 4, 6, 8];
  var DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  function track(name, params) { if (window.ambleTrack) window.ambleTrack(name, params); }
  var ICONS = {
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M9 15l2 2 4-4"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M12 11.5v6M9.5 15l2.5 2.5 2.5-2.5"/>',
  };
  function icon(name, size) {
    var t = document.createElement("template");
    t.innerHTML = '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return t.content.firstChild;
  }

  // ---- days ------------------------------------------------------------------------------------------------
  function dateOf(day, time) {            // the person's own clock, never pinned to a time zone
    var p = time && TIME_RE.test(time) ? time.split(":") : [12, 0];
    return new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +p[0], +p[1]);
  }
  function realDay(v) { return typeof v === "string" && DAY_RE.test(v) && ymd(dateOf(v)) === v; }
  function addDays(day, n) { var t = dateOf(day); t.setDate(t.getDate() + n); return ymd(t); }
  function nextSaturday() { var t = new Date(); t.setDate(t.getDate() + ((6 - t.getDay() + 7) % 7 || 7)); return ymd(t); }
  // "Saturday, November 21" this year, "Sunday, July 4, 2027" otherwise
  function prettyDay(day, withYear) {
    var t = dateOf(day);
    var s = DAYS[t.getDay()] + ", " + MONTHS[t.getMonth()] + " " + t.getDate();
    return withYear || t.getFullYear() !== new Date().getFullYear() ? s + ", " + t.getFullYear() : s;
  }
  function prettyTime(time) {
    if (!time || !TIME_RE.test(time)) return "";
    var h = +time.slice(0, 2), m = time.slice(3);
    return (h % 12 || 12) + (m === "00" ? "" : ":" + m) + (h < 12 ? " a.m." : " p.m.");
  }
  function seasonOf(day) { return SEASON_OF_MONTH[dateOf(day).getMonth()]; }
  function outOfSeason(m, day) {
    var s = m && m.season;
    if (!s || s === "any" || !realDay(day)) return false;
    return (Array.isArray(s) ? s : [s]).indexOf(seasonOf(day)) < 0;
  }

  // ---- the event ---------------------------------------------------------------------------------------------
  function pretty(item) { return String(item || "").replace(/-/g, " "); }
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function gearLines(m) {
    var g = Array.isArray(m.gear) ? m.gear : [];
    var of = function (rent) { return g.filter(function (x) { return (x.rent || "no") === rent; }).map(function (x) { return pretty(x.item); }); };
    var out = [];
    if (of("no").length) out.push("Bring: " + andList(of("no")));
    if (of("on-site").length) out.push("Rent there: " + andList(of("on-site")));
    if (of("nearby").length) out.push("Rent nearby: " + andList(of("nearby")));
    return out;
  }
  function whereOf(m) {
    var p = m.place;
    if (!p) return "";
    var bits = [p.name, p.address || p.area].filter(Boolean);
    if (bits.length) return bits.join(", ");
    return Array.isArray(p.coords) ? p.coords[0] + ", " + p.coords[1] : "";
  }
  function missionUrl(m) { return SITE + "/missions/" + encodeURIComponent(m.id || String(m.full_id || "").split("/")[1]) + "/"; }

  // plan: { day, time, hours, remind: "none" | "morning" | "day-before", vote_name? }
  function event(m, plan) {
    var details = [m.short || ""].concat(gearLines(m)).filter(Boolean);
    details.push("", "The mission: " + missionUrl(m));
    var coords = m.place && Array.isArray(m.place.coords) ? m.place.coords : null;
    return {
      uid: (plan.id || Math.random().toString(36).slice(2)) + "@amblebee.com",
      title: plan.vote_name ? plan.vote_name + ": " + m.name : m.name + " · AmbleBee",
      details: details.join("\n"), location: whereOf(m), geo: coords, url: missionUrl(m),
      day: plan.day, time: plan.time && TIME_RE.test(plan.time) ? plan.time : null,
      hours: LENGTHS.indexOf(+plan.hours) >= 0 ? +plan.hours : HOURS[m.duration] || 2,
      remind: plan.remind || "day-before",
    };
  }
  function ends(ev) {          // [start Date, end Date] for a timed event
    var s = dateOf(ev.day, ev.time);
    return [s, new Date(s.getTime() + ev.hours * 3600 * 1000)];
  }
  function compact(day) { return day.replace(/-/g, ""); }
  function local(t) { return ymd(t).replace(/-/g, "") + "T" + pad(t.getHours()) + pad(t.getMinutes()) + "00"; }
  function utc(t) { return t.toISOString().replace(/\.\d{3}Z$/, "Z"); }
  function q(params) {
    return Object.keys(params).filter(function (k) { return params[k] != null && params[k] !== ""; })
      .map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
  }

  // Google: all-day events take dates with an exclusive end; timed ones are local times read in the person's own zone
  function googleUrl(ev) {
    var dates;
    if (!ev.time) dates = compact(ev.day) + "/" + compact(addDays(ev.day, 1));
    else { var se = ends(ev); dates = local(se[0]) + "/" + local(se[1]); }
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* old browser: Google uses the account's zone */ }
    return "https://calendar.google.com/calendar/render?" +
      q({ action: "TEMPLATE", text: ev.title, dates: dates, details: ev.details, location: ev.location, ctz: ev.time ? tz : "" });
  }
  // Outlook on the web: outlook.live.com for personal accounts, outlook.office.com for work and school
  function outlookUrl(ev, work) {
    var p = { path: "/calendar/action/compose", rru: "addevent", subject: ev.title, body: ev.details, location: ev.location };
    if (!ev.time) { p.startdt = ev.day; p.enddt = addDays(ev.day, 1); p.allday = "true"; }
    else { var se = ends(ev); p.startdt = utc(se[0]); p.enddt = utc(se[1]); p.allday = "false"; }
    return (work ? "https://outlook.office.com" : "https://outlook.live.com") + "/calendar/0/action/compose?" + q(p);
  }

  // ---- .ics (RFC 5545): CRLF lines folded at 75 bytes, text escaped, floating local times, a display alarm ----
  function esc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function fold(line) {
    var out = [], cur = "", bytes = 0, max = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], code = line.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) { ch += line[++i]; }   // keep emoji pairs together
      var n = new TextEncoder().encode(ch).length;
      if (bytes + n > max) { out.push(cur); cur = " "; bytes = 1; max = 75; }
      cur += ch; bytes += n;
    }
    out.push(cur);
    return out.join("\r\n");
  }
  function dur(mins) {          // minutes → an iCalendar duration, signed
    var sign = mins < 0 ? "-" : "";
    mins = Math.abs(mins);
    var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    var s = "P" + (d ? d + "D" : "");
    if (h || m || !d) s += "T" + (h ? h + "H" : "") + (m ? m + "M" : "") + (!h && !m ? "0M" : "");
    return sign + s;
  }
  function trigger(ev) {
    if (ev.remind === "none") return null;
    if (!ev.time) return ev.remind === "morning" ? dur(8 * 60) : dur(-15 * 60);   // all day: 8 a.m. that day, or 9 a.m. the day before
    if (ev.remind !== "morning") return "-P1D";                                    // the day before: 24 hours ahead
    var startMin = +ev.time.slice(0, 2) * 60 + +ev.time.slice(3);
    return startMin >= 9 * 60 ? dur(8 * 60 - startMin) : dur(-60);               // 8 a.m. that day, or an hour ahead of an early start
  }
  function ics(ev) {
    var stamp = utc(new Date()).replace(/[-:]/g, "");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AmbleBee//Plans//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
                 "BEGIN:VEVENT", "UID:" + ev.uid, "DTSTAMP:" + stamp];
    if (!ev.time) lines.push("DTSTART;VALUE=DATE:" + compact(ev.day), "DTEND;VALUE=DATE:" + compact(addDays(ev.day, 1)));
    else { var se = ends(ev); lines.push("DTSTART:" + local(se[0]), "DTEND:" + local(se[1])); }
    lines.push("SUMMARY:" + esc(ev.title), "DESCRIPTION:" + esc(ev.details));
    if (ev.location) lines.push("LOCATION:" + esc(ev.location));
    if (ev.geo) lines.push("GEO:" + ev.geo[0] + ";" + ev.geo[1]);
    lines.push("URL:" + ev.url);
    var tr = trigger(ev);
    if (tr) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + esc(ev.title), "TRIGGER:" + tr, "END:VALARM");
    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }
  function download(ev, slug) {
    var blob = new Blob([ics(ev)], { type: "text/calendar;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: (slug || "amblebee-plan") + ".ics" });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // ---- the "Plan this mission" dialog -----------------------------------------------------------------------
  var dlg = null;
  function info(m) { return { mission: m.full_id, slug: m.id || String(m.full_id).split("/")[1], name: m.name }; }
  // opts: { day, time, vote_name, from }   (from: what to focus after closing)
  function open(m, opts) {
    opts = opts || {};
    var D = window.AmbleDone;
    if (!m || !m.full_id) return;
    var mine = D ? D.plansFor(m.full_id).filter(function (x) { return x.day >= today(); }) : [];
    var start = opts.day && realDay(opts.day) ? opts.day : mine.length ? mine[0].day : nextSaturday();
    var startTime = opts.time || (mine.length && mine[0].day === start ? mine[0].time : null);
    if (!dlg) {
      dlg = el("dialog", { id: "plan-dialog", "aria-labelledby": "plan-title" });
      document.body.append(dlg);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });   // a tap on the dim backdrop
    }
    var back = opts.from || document.activeElement;
    dlg.onclose = function () { if (back && back.isConnected && back.focus) back.focus(); };

    var day = el("input", { id: "plan-day", type: "date", value: start, min: today(), required: true });
    var season = el("p", { class: "plan-season", role: "status", "aria-live": "polite" });
    var allDay = el("input", { type: "radio", name: "plan-when", value: "all", checked: !startTime });
    var timed = el("input", { type: "radio", name: "plan-when", value: "time", checked: !!startTime });
    var time = el("input", { id: "plan-time", type: "time", value: startTime || "10:00", "aria-label": "Start time" });
    var length = el("select", { id: "plan-length" }, LENGTHS.map(function (h) {
      return el("option", { value: String(h), selected: h === (HOURS[m.duration] || 2) }, h === 1 ? "1 hour" : h + " hours");
    }));
    var remind = el("select", { id: "plan-remind" },
      el("option", { value: "none" }, "No reminder"), el("option", { value: "morning" }, "The morning of"),
      el("option", { value: "day-before", selected: true }, "The day before"));
    var lengthRow = el("div", { class: "done-field plan-length" }, el("label", { for: "plan-length", text: "How long" }), length);
    var done = el("p", { class: "plan-done", role: "status", "aria-live": "polite" });

    function current() {
      return { day: day.value, time: timed.checked && TIME_RE.test(time.value) ? time.value : null, hours: +length.value,
               remind: remind.value, vote_name: opts.vote_name || null };
    }
    var google = el("a", { class: "btn plan-cal plan-google", target: "_blank", rel: "noopener" }, "Google Calendar");
    var outlook = el("a", { class: "btn plan-cal plan-outlook", target: "_blank", rel: "noopener" }, "Outlook");
    var outlookWork = el("a", { class: "btn plan-cal plan-outlook-work", target: "_blank", rel: "noopener" }, "Outlook for work or school");
    var file = el("button", { type: "button", class: "btn plan-cal plan-ics" }, icon("file", 18), "Apple and other calendars");
    var links = [google, outlook, outlookWork];
    function refresh() {
      var ok = realDay(day.value) && day.value >= today();
      day.setAttribute("aria-invalid", ok ? "false" : "true");
      time.disabled = !timed.checked;
      lengthRow.hidden = !timed.checked;
      season.textContent = ok && outOfSeason(m, day.value) ? "Out of season on " + prettyDay(day.value, true) + ". It may be closed or not at its best, so check before you go." : "";
      if (!ok) season.textContent = "Pick a day from today on.";
      var ev = ok ? event(m, current()) : null;
      links.forEach(function (a, i) {
        if (ev) { a.href = i === 0 ? googleUrl(ev) : outlookUrl(ev, i === 2); a.removeAttribute("aria-disabled"); }
        else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
      });
      file.disabled = !ok;
    }
    function save(via) {
      var p = current();
      if (!realDay(p.day) || p.day < today()) return false;
      var made = D ? D.addPlan(info(m), p.day, p.time, opts.vote_name ? { source: "vote", vote_name: opts.vote_name, vote_id: opts.vote_id } : null) : null;
      track("calendar_added", { mission_id: info(m).slug, via: via });
      done.replaceChildren(icon("check", 18), el("span", {},
        made ? "Saved to My plans. We'll ask how it went after " + prettyDay(p.day) + ". " : "Added. ",
        made ? el("a", { href: "/me/plans/" }, "See My plans") : null));
      return true;
    }
    google.addEventListener("click", function (e) { if (!save("google")) e.preventDefault(); });
    outlook.addEventListener("click", function (e) { if (!save("outlook")) e.preventDefault(); });
    outlookWork.addEventListener("click", function (e) { if (!save("outlook_work")) e.preventDefault(); });
    file.addEventListener("click", function () {
      if (!save("file")) return;
      download(event(m, Object.assign({ id: m.id }, current())), info(m).slug);
    });
    [day, time, length, remind].forEach(function (x) { x.addEventListener("input", refresh); x.addEventListener("change", refresh); });
    [allDay, timed].forEach(function (x) { x.addEventListener("change", function () { refresh(); if (timed.checked) time.focus(); }); });
    time.addEventListener("focus", function () { if (!timed.checked) { timed.checked = true; refresh(); } });

    var sheet = el("div", { class: "plan-sheet" },
      el("form", { method: "dialog", class: "x-form" },
        el("button", { class: "x-close", value: "close", "aria-label": "Close" }, icon("x", 22))),
      el("h2", { id: "plan-title", class: "plan-kicker" }, "Plan this mission"),
      el("p", { class: "gift-mission" }, icon("calendar", 18), opts.vote_name ? opts.vote_name + ": " + m.name : m.name),
      el("div", { class: "plan-grid" },
        el("div", { class: "done-field" }, el("label", { for: "plan-day", text: "Day" }), day),
        el("fieldset", { class: "plan-when" }, el("legend", { text: "Time" }),
          el("label", { class: "check" }, allDay, "All day"),
          el("label", { class: "check plan-at" }, timed, "Start at ", time)),
        lengthRow,
        el("div", { class: "done-field" }, el("label", { for: "plan-remind", text: "Reminder" }), remind,
          el("p", { class: "hint", text: "The reminder is in the Apple and other calendars file. Google and Outlook use your calendar's usual reminder." }))),
      season,
      el("p", { class: "plan-label", text: "Add it to" }),
      el("div", { class: "plan-cals" }, google, outlook, outlookWork, file),
      done,
      el("p", { class: "plan-privacy", text: "Nothing is sent anywhere until you pick a calendar, and then only this event goes to it. The Apple file is made on your device." }));
    dlg.replaceChildren(sheet);
    refresh();
    if (!dlg.open) dlg.showModal();
    day.focus();
  }

  // ---- the button at the bottom of a mission ---------------------------------------------------------------
  // "Add to calendar" on the left, a filled honey button, well away from Not for us; with the next plan under it
  function button(m) {
    if (!m || !m.full_id) return null;
    var wrap = el("div", { class: "plan-acts" });
    var b = el("button", { type: "button", class: "btn small plan-btn" }, icon("calendar", 20), "Add to calendar");
    b.addEventListener("click", function () { open(m, { from: b }); });
    // Start a vote, the other "plan it" button (calendar-voting-PLAN.md §3), styled differently (site/js/votes.js)
    var vote = el("a", { class: "btn small vote-start", href: "/vote/new/#add=" + m.full_id }, "Start a vote");
    var note = el("p", { class: "plan-note" });
    function paint() {
      var D = window.AmbleDone, next = D ? D.plansFor(m.full_id).filter(function (x) { return x.day >= today(); })[0] : null;
      note.replaceChildren();
      note.hidden = !next;
      if (next) note.append(icon("check", 16), "Planned for " + prettyDay(next.day) + (next.time ? " at " + prettyTime(next.time) : "") + " · ",
                            el("a", { href: "/me/plans/" }, "My plans"));
    }
    paint();
    window.addEventListener("amble:done", function () { if (wrap.isConnected) paint(); });
    wrap.append(el("div", { class: "plan-row" }, b, vote), note);
    return wrap;
  }

  // ---- My plans (/me/plans/) and Coming up (/me/) ------------------------------------------------------------
  var catalog = null;
  function loadCatalog() {
    if (!catalog) catalog = fetch("/catalog.json", { cache: "force-cache" }).then(function (r) { return r.json(); })
      .then(function (c) { var by = {}; (c.missions || []).forEach(function (m) { by[m.full_id] = m; }); return by; }, function () { return {}; });
    return catalog;
  }
  function doneInfo(p, m) {
    m = m || {};
    return { mission: p.mission, slug: p.slug, name: p.name, pack: m.pack || "", mode: m.mode || "", setting: m.setting || "either",
             time_of_day: m.time_of_day || "any", themes: m.themes || [] };
  }
  function fromLine(p) { return p.source === "vote" && p.vote_name ? "From " + p.vote_name : "From your calendar"; }

  // "Did you go?" for one plan whose day has passed: Mark it done (on that day) or We didn't go
  function askRow(p, by, say) {
    var row = el("li", { class: "plan-ask", "data-plan": p.id });
    var mark = el("button", { type: "button", class: "btn small primary plan-yes" }, icon("check", 18), "Mark it done");
    var no = el("button", { type: "button", class: "btn small plan-no" }, "We didn't go");
    mark.addEventListener("click", function () {
      var D = window.AmbleDone; if (!D) return;
      var c = D.add(doneInfo(p, by[p.mission]), dateOf(p.day, p.time));
      if (!c) return;
      var news = window.AmbleStamps ? window.AmbleStamps.fresh() : [];
      say("Marked done for " + prettyDay(p.day) + "." + (news.length ? " New stamp: " + news.map(function (s) { return s.name; }).join(", ") + "." : ""),
          news.length && window.AmbleStamps && window.AmbleStamps.landing ? window.AmbleStamps.landing(news, true) : null);
    });
    no.addEventListener("click", function () {
      var D = window.AmbleDone; if (!D) return;
      D.removePlan(p.id);
      say("Cleared. Maybe next time.");
    });
    row.append(el("p", {}, "You planned ", el("a", { href: "/missions/" + encodeURIComponent(p.slug) + "/" }, p.name),
                  " for " + prettyDay(p.day) + ". ", el("b", { text: "Did you go?" })),
               el("div", { class: "plan-row-acts" }, mark, no));
    return row;
  }
  function upcomingRow(p, by) {
    var m = by[p.mission];
    var again = el("button", { type: "button", class: "btn small plan-again" }, icon("calendar", 18), "Add to calendar");
    again.disabled = !m;
    again.addEventListener("click", function () { if (m) open(m, { day: p.day, time: p.time, vote_name: p.vote_name, from: again }); });
    var remove = el("button", { type: "button", class: "linkish plan-remove" }, "Remove");
    remove.addEventListener("click", function () { if (window.AmbleDone) window.AmbleDone.removePlan(p.id); });
    return el("li", { class: "plan-item", "data-plan": p.id },
      el("p", { class: "plan-when-big" }, el("time", { datetime: p.day, text: prettyDay(p.day) }), p.time ? el("span", { text: " · " + prettyTime(p.time) }) : null),
      el("p", { class: "plan-name" }, el("a", { href: "/missions/" + encodeURIComponent(p.slug) + "/" }, p.name)),
      el("p", { class: "plan-from", text: fromLine(p) }),
      el("div", { class: "plan-row-acts" }, again, remove));
  }
  function mountPlansPage(root) {
    var live = el("p", { class: "sr", "aria-live": "polite" });
    var landed = null, lastSaid = "";
    function say(text, landing) { lastSaid = text; landed = landing || null; live.textContent = ""; setTimeout(function () { live.textContent = text; }, 50); draw(); }
    function draw() {
      var D = window.AmbleDone;
      if (!D) return;
      loadCatalog().then(function (by) {
        var all = D.plans(), t = today();
        var past = all.filter(function (p) { return p.day < t; }), next = all.filter(function (p) { return p.day >= t; });
        var kids = [];
        if (lastSaid) kids.push(el("p", { class: "plan-said", role: "status" }, icon("check", 18), lastSaid), landed);
        if (past.length) kids.push(el("section", { class: "plan-section", "aria-labelledby": "plans-ask" },
          el("h2", { id: "plans-ask", text: "Did you go?" }),
          el("ul", { class: "plan-list" }, past.map(function (p) { return askRow(p, by, say); }))));
        kids.push(el("section", { class: "plan-section", "aria-labelledby": "plans-next" },
          el("h2", { id: "plans-next", text: "Coming up" }),
          next.length ? el("ul", { class: "plan-list" }, next.map(function (p) { return upcomingRow(p, by); }))
            : el("p", { class: "plan-empty" }, "Nothing planned yet. Open any mission and tap ", el("b", { text: "Add to calendar" }), ", and it shows up here.")));
        kids.push(el("p", { class: "hint", text: window.AmbleProfile && window.AmbleProfile.has() ? "Saved to your profile, so they show on all your devices." :
          "Saved on this device only. Start a free profile in Settings to keep them on all your devices." }), live);
        root.replaceChildren.apply(root, kids.filter(Boolean));
      });
    }
    draw();
    window.addEventListener("amble:done", draw);
  }
  function mountComingUp(root) {
    function draw() {
      var D = window.AmbleDone;
      if (!D) return;
      var all = D.plans(), t = today();
      var past = all.filter(function (p) { return p.day < t; }), next = all.filter(function (p) { return p.day >= t; }).slice(0, 3);
      root.hidden = !all.length;
      if (!all.length) { root.replaceChildren(); return; }
      // (the browser writes "null" for an empty slot, so the parts left out are filtered first)
      root.replaceChildren.apply(root, [
        el("h2", { id: "coming-up-title", text: "Coming up" }),
        past.length ? el("p", { class: "plan-ask-line" }, icon("check", 18),
          el("a", { href: "/me/plans/" }, past.length === 1 ? "Did you go to " + past[0].name + "?" : "Did you go? " + past.length + " plans have passed.")) : null,
        next.length ? el("ul", { class: "coming-list" }, next.map(function (p) {
          return el("li", {}, el("time", { datetime: p.day, text: prettyDay(p.day) }), " · ",
            el("a", { href: "/missions/" + encodeURIComponent(p.slug) + "/" }, p.name));
        })) : null,
        el("p", {}, el("a", { class: "btn small", href: "/me/plans/" }, "See all my plans", icon("arrow", 18)))].filter(Boolean));
    }
    draw();
    window.addEventListener("amble:done", draw);
  }

  // mission pages: <div class="plan-slot" data-plan='{...}'></div>
  function mount() {
    document.querySelectorAll(".plan-slot[data-plan]").forEach(function (slot) {
      if (slot.firstChild) return;
      var m;
      try { m = JSON.parse(slot.getAttribute("data-plan")); } catch (e) { return; }
      var b = button(m);
      if (b) slot.append(b);
    });
    var p = document.querySelector(".plans-app");
    if (p) mountPlansPage(p);
    var c = document.querySelector(".coming-up");
    if (c) mountComingUp(c);
  }

  window.AmblePlans = { button: button, open: open, event: event, googleUrl: googleUrl, outlookUrl: outlookUrl, ics: ics,
                        outOfSeason: outOfSeason, prettyDay: prettyDay };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
