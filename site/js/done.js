/* "Mark done": the missions you've done, with how they went, kept in this browser only.
   Nothing here is sent anywhere. Everything lives under one key ("amble.done") so it can be backed up,
   moved to another device with a backup code, and later synced to a profile.

   Used by the mission pages (a .done-slot with the mission's details in data-mission), the mission popup
   on the home page (AmbleDone.box(m) from site/js/ticket.js) and the Your missions page (site/js/me.js).

   One completion looks like this (the same shape the Hive and the profile server will use):
     { rid, mission: "max/sunset-picnic", slug: "sunset-picnic", name, done_at: ISO time,
       snapshot: { pack, mode, setting, time_of_day, themes }   // the mission as it was, for stamps later
       as_date: true/false, rating: "up" | "down" | null, note: "" }
   A mission can be done more than once; each time is its own completion. "Not for us" missions are
   kept in a separate list (hidden) so they're never picked for you again on this device.
   settings holds the two things stamps need from you (site/js/stamps.js): { home_state: "oregon", anniversary: "06-14" }.

   For a profile (site/js/profile.js), the list also remembers what changed since the profile last had it: each
   completion has updated_at, "dirty" lists the ones to send, "removed" the ones taken off, and prefs_at /
   prefs_dirty do the same for Not for us and the settings. Without a profile these just sit there.

   Plans (claude/calendar-voting-PLAN.md, branch 1) live here too, so backups, the profile sync and moving into a new
   profile carry them like everything else:
     { id, mission, slug, name, day: "2027-07-04", time: "09:30" | null, source: "calendar" | "vote",
       vote_id, vote_name, added_at, updated_at }
   plans_dirty / plans_removed track what the profile hasn't heard yet. Marking a mission done clears its plans for
   that day or earlier, and the completion remembers it was planned (via: "plan", planned_at) for the Planned Ahead
   stamp. Plans more than 60 days past without an answer are cleared quietly. */
(function () {
  "use strict";
  var U = window.AmbleUtil, el = U.el, ymd = U.ymd, today = U.today;

  var KEY = "amble.done";
  var NOTE_MAX = 300;     // "Anything to remember?"
  var KEEP_MAX = 5000;    // completions kept (far more than anyone will reach)
  var CODE_PREFIX = "AMB1:";
  var ID_RE = /^[a-z0-9-]+\/[a-z0-9-]+$/;
  var STATE_RE = /^[a-z]+(-[a-z]+)*$/;
  var ANNIV_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var ID6 = /^[a-z0-9]{6,16}$/;
  var PLANS_MAX = 500;
  var PLAN_STALE_DAYS = 60;   // a plan this far past its day, never answered, is cleared quietly
  var mem = null;         // used when the browser won't keep localStorage (private mode)

  // ---- storage --------------------------------------------------------------------------------------
  function empty() { return { v: 1, done: [], hidden: [], settings: {}, dirty: [], removed: [], prefs_at: null, prefs_dirty: false,
                             plans: [], plans_dirty: [], plans_removed: [] }; }
  function stamp() { return new Date().toISOString(); }
  function dirty(d, rid) { if (d.dirty.indexOf(rid) < 0) d.dirty.push(rid); }
  function prefsChanged(d) { d.prefs_at = stamp(); d.prefs_dirty = true; }
  function cleanSettings(x) {
    var out = {};
    if (x && typeof x === "object") {
      if (typeof x.home_state === "string" && x.home_state.length <= 30 && STATE_RE.test(x.home_state)) out.home_state = x.home_state;
      if (typeof x.anniversary === "string" && ANNIV_RE.test(x.anniversary)) out.anniversary = x.anniversary;
      // the display name (calendar-voting-PLAN.md, decision 39): plain text, one line, 30 characters at most
      if (typeof x.display_name === "string") {
        var nm = x.display_name.replace(/[<>\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 30).trim();
        if (nm) out.display_name = nm;
      }
      var cur = cleanCurrent(x.current);
      if (cur) out.current = cur;
    }
    return out;
  }
  // The mission you're on right now (Start mission, site/js/current.js): one at a time, until it's marked done or
  // cancelled. It rides along in the settings so the profile carries it to your other devices.
  //   { mission, slug, name, pack, mode, setting, time_of_day, themes, steps: ["…"], got: [0, 2], started_at }
  // "got" is which photo prompts you've ticked off. The prompts are copied in, so the bar works on every page
  // without loading the whole catalog.
  var STEP_MAX = 12, STEP_LEN = 240;
  function cleanCurrent(c) {
    if (!c || typeof c !== "object" || typeof c.mission !== "string" || !ID_RE.test(c.mission)) return null;
    var t = new Date(c.started_at);
    if (isNaN(t.getTime())) return null;
    var str = function (v, max) { return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : ""; };
    var steps = (Array.isArray(c.steps) ? c.steps : []).filter(function (x) { return typeof x === "string" && x.trim(); })
      .slice(0, STEP_MAX).map(function (x) { return str(x, STEP_LEN); });
    var got = (Array.isArray(c.got) ? c.got : []).filter(function (i, k, a) {
      return typeof i === "number" && i % 1 === 0 && i >= 0 && i < steps.length && a.indexOf(i) === k; });
    return {
      mission: c.mission, slug: str(c.slug, 80) || c.mission.split("/")[1], name: str(c.name, 120) || c.mission.split("/")[1],
      pack: str(c.pack, 40), mode: str(c.mode, 20), setting: str(c.setting, 20), time_of_day: str(c.time_of_day, 20),
      themes: (Array.isArray(c.themes) ? c.themes : []).filter(function (x) { return typeof x === "string"; }).slice(0, 12).map(function (x) { return x.slice(0, 30); }),
      steps: steps, got: got.sort(function (a, b) { return a - b; }), started_at: t.toISOString(),
    };
  }
  function read() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (raw == null) return mem ? JSON.parse(JSON.stringify(mem)) : empty();
    try { return clean(JSON.parse(raw)) || empty(); } catch (e) { return empty(); }
  }
  function write(d) {
    mem = d;
    try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
  }
  function changed() {
    try { window.dispatchEvent(new CustomEvent("amble:done")); } catch (e) { /* very old browser */ }
  }

  // Only well-formed records get in, whether from storage or from a pasted backup code.
  function cleanOne(c) {
    if (!c || typeof c !== "object" || typeof c.mission !== "string" || !ID_RE.test(c.mission)) return null;
    var t = new Date(c.done_at);
    if (isNaN(t.getTime())) return null;
    var s = c.snapshot && typeof c.snapshot === "object" ? c.snapshot : {};
    var str = function (v, max) { return typeof v === "string" ? v.slice(0, max) : ""; };
    return {
      rid: typeof c.rid === "string" && /^[a-z0-9]{6,16}$/.test(c.rid) ? c.rid : newId(),
      mission: c.mission,
      slug: str(c.slug, 80) || c.mission.split("/")[1],
      name: str(c.name, 120) || c.mission.split("/")[1],
      done_at: t.toISOString(),
      snapshot: {
        pack: str(s.pack, 40), mode: str(s.mode, 20), setting: str(s.setting, 20), time_of_day: str(s.time_of_day, 20),
        themes: Array.isArray(s.themes) ? s.themes.filter(function (x) { return typeof x === "string"; }).slice(0, 12).map(function (x) { return x.slice(0, 30); }) : [],
      },
      as_date: c.as_date === true,
      rating: c.rating === "up" || c.rating === "down" ? c.rating : null,
      note: str(c.note, NOTE_MAX),
      via: c.via === "plan" || c.via === "vote" ? c.via : null,
      planned_at: (c.via === "plan" || c.via === "vote") && !isNaN(new Date(c.planned_at).getTime()) ? new Date(c.planned_at).toISOString() : null,
      updated_at: !isNaN(new Date(c.updated_at).getTime()) ? new Date(c.updated_at).toISOString() : t.toISOString(),
    };
  }
  function realDay(v) {
    if (typeof v !== "string" || !DAY_RE.test(v)) return false;
    var t = new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10));
    return t.getMonth() === +v.slice(5, 7) - 1;   // not 2027-02-30
  }
  function cleanPlan(x) {
    // day "" is a Someday plan: saved to My plans with no day, so no calendar, reminder or "Did you go?" yet
    if (!x || typeof x !== "object" || typeof x.mission !== "string" || !ID_RE.test(x.mission) || !(x.day === "" || realDay(x.day))) return null;
    var added = new Date(x.added_at);
    if (isNaN(added.getTime())) return null;
    var str = function (v, max) { return typeof v === "string" ? v.slice(0, max) : ""; };
    var vote = x.source === "vote";
    return {
      id: typeof x.id === "string" && ID6.test(x.id) ? x.id : newId(),
      mission: x.mission, slug: str(x.slug, 80) || x.mission.split("/")[1], name: str(x.name, 120) || x.mission.split("/")[1],
      day: x.day, time: x.day && typeof x.time === "string" && TIME_RE.test(x.time) ? x.time : null,
      source: vote ? "vote" : "calendar",
      vote_id: vote && typeof x.vote_id === "string" && /^[A-Za-z0-9_-]{8,24}$/.test(x.vote_id) ? x.vote_id : null,
      vote_name: vote ? (str(x.vote_name, 60).trim() || null) : null,
      added_at: added.toISOString(),
      updated_at: !isNaN(new Date(x.updated_at).getTime()) ? new Date(x.updated_at).toISOString() : added.toISOString(),
    };
  }
  function daysAgo(n) { var t = new Date(); t.setDate(t.getDate() - n); return ymd(t); }
  var soonest = function (a, b) { var x = a.day + (a.time || ""), y = b.day + (b.time || ""); return x < y ? -1 : x > y ? 1 : 0; };
  function dropPlan(d, id) {
    var n = d.plans.length;
    d.plans = d.plans.filter(function (x) { return x.id !== id; });
    d.plans_dirty = d.plans_dirty.filter(function (x) { return x !== id; });
    if (d.plans.length !== n && d.plans_removed.indexOf(id) < 0) d.plans_removed.push(id);
    return d.plans.length !== n;
  }
  // Clears plans for a mission on or before a day (it's been done); returns the one with the most notice, for via
  function usePlans(d, mission, day) {
    var hit = d.plans.filter(function (x) { return x.mission === mission && x.day <= day; });
    hit.forEach(function (x) { dropPlan(d, x.id); });
    hit.sort(function (a, b) { return a.added_at < b.added_at ? -1 : 1; });
    return hit[0] || null;
  }
  function stalePlans(d) {
    var cut = daysAgo(PLAN_STALE_DAYS), gone = false;
    d.plans.slice().forEach(function (x) { if (x.day && x.day < cut) gone = dropPlan(d, x.id) || gone; });   // Someday plans stay
    return gone;
  }
  function clean(d) {
    if (!d || d.v !== 1 || !Array.isArray(d.done)) return null;
    var out = empty();
    var seen = {};
    d.done.forEach(function (c) {
      var x = cleanOne(c);
      if (x && !seen[x.rid]) { seen[x.rid] = 1; out.done.push(x); }
    });
    out.done = out.done.slice(-KEEP_MAX);
    out.hidden = (Array.isArray(d.hidden) ? d.hidden : []).filter(function (id) { return typeof id === "string" && ID_RE.test(id); });
    out.settings = cleanSettings(d.settings);
    var rids = {};
    out.done.forEach(function (c) { rids[c.rid] = 1; });
    var ridOk = function (r) { return typeof r === "string" && /^[a-z0-9]{6,16}$/.test(r); };
    out.dirty = (Array.isArray(d.dirty) ? d.dirty : []).filter(function (r) { return ridOk(r) && rids[r]; });
    out.removed = (Array.isArray(d.removed) ? d.removed : []).filter(ridOk).slice(-2000);
    out.prefs_at = d.prefs_at && !isNaN(new Date(d.prefs_at).getTime()) ? new Date(d.prefs_at).toISOString() : null;
    out.prefs_dirty = d.prefs_dirty === true;
    var pseen = {};
    (Array.isArray(d.plans) ? d.plans : []).forEach(function (x) {
      var y = cleanPlan(x);
      if (y && !pseen[y.id]) { pseen[y.id] = 1; out.plans.push(y); }
    });
    out.plans = out.plans.slice(-PLANS_MAX);
    var pids = {};
    out.plans.forEach(function (x) { pids[x.id] = 1; });
    out.plans_dirty = (Array.isArray(d.plans_dirty) ? d.plans_dirty : []).filter(function (r) { return ridOk(r) && pids[r]; });
    out.plans_removed = (Array.isArray(d.plans_removed) ? d.plans_removed : []).filter(ridOk).slice(-2000);
    return out;
  }
  function newId() {
    var a = new Uint8Array(6);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  var newest = function (a, b) { return a.done_at < b.done_at ? 1 : a.done_at > b.done_at ? -1 : 0; };

  // ---- the API the rest of the site uses -------------------------------------------------------------
  var api = {
    list: function () { return read().done.sort(newest); },
    forMission: function (id) { return read().done.filter(function (c) { return c.mission === id; }).sort(newest); },
    // info: { mission, slug, name, pack, mode, setting, time_of_day, themes }
    // Any plans for this mission on or before the day are cleared, and the completion remembers it was planned.
    add: function (info, when) {
      var d = read();
      var c = cleanOne({
        mission: info.mission, slug: info.slug, name: info.name, done_at: (when || new Date()).toISOString(),
        snapshot: { pack: info.pack, mode: info.mode, setting: info.setting, time_of_day: info.time_of_day, themes: info.themes },
        as_date: info.mode === "date",
      });
      if (!c) return null;
      var used = usePlans(d, c.mission, ymd(new Date(c.done_at)));
      if (used) { c.via = used.source === "vote" ? "vote" : "plan"; c.planned_at = used.added_at; }
      c.updated_at = stamp();
      d.done.push(c);
      dirty(d, c.rid);
      d.done = d.done.slice(-KEEP_MAX);
      if (d.settings.current && d.settings.current.mission === c.mission) {   // the mission you were on: finished
        delete d.settings.current; prefsChanged(d);
      }
      write(d); changed();
      track("mission_done", { mission_id: c.slug });
      return c;
    },
    update: function (rid, patch) {
      var d = read();
      var c = d.done.find(function (x) { return x.rid === rid; });
      if (!c) return null;
      if ("rating" in patch) c.rating = patch.rating === "up" || patch.rating === "down" ? patch.rating : null;
      if ("note" in patch) c.note = String(patch.note || "").slice(0, NOTE_MAX);
      if ("as_date" in patch) c.as_date = patch.as_date === true;
      if ("done_at" in patch) { var t = new Date(patch.done_at); if (!isNaN(t.getTime())) c.done_at = t.toISOString(); }
      c.updated_at = stamp();
      dirty(d, rid);
      write(d);
      if (!("note" in patch)) changed();   // a note is saved as you type; nothing else needs to redraw for it
      else try { window.dispatchEvent(new CustomEvent("amble:note")); } catch (e) { /* old browser */ }   // but the profile still sends it
      return c;
    },
    remove: function (rid) {
      var d = read();
      var n = d.done.length;
      d.done = d.done.filter(function (x) { return x.rid !== rid; });
      if (d.done.length !== n) {
        d.dirty = d.dirty.filter(function (x) { return x !== rid; });
        if (d.removed.indexOf(rid) < 0) d.removed.push(rid);
        write(d); changed();
      }
    },
    hidden: function () { return new Set(read().hidden); },

    // ---- plans (site/js/plans.js) ----
    plans: function () {
      var d = read();
      if (stalePlans(d)) { write(d); changed(); }
      return d.plans.slice().sort(soonest);
    },
    plansFor: function (id) { return api.plans().filter(function (x) { return x.mission === id; }); },
    // info: { mission, slug, name }; one plan per mission and day (planning it again for that day updates its time)
    addPlan: function (info, day, time, extra) {
      var d = read();
      // the same mission and day is the same plan; picking a day for a Someday plan moves it rather than adding another
      var same = d.plans.find(function (x) { return x.mission === info.mission && x.day === day; }) ||
                 (day ? d.plans.find(function (x) { return x.mission === info.mission && x.day === ""; }) : null);
      var now = stamp();
      var x = cleanPlan(Object.assign({ id: same ? same.id : newId(), mission: info.mission, slug: info.slug, name: info.name, day: day,
                                        time: time || null, source: "calendar", added_at: same ? same.added_at : now }, extra || {}));
      if (!x) return null;
      x.updated_at = now;
      d.plans = d.plans.filter(function (y) { return y.id !== x.id; });
      d.plans.push(x);
      if (d.plans_dirty.indexOf(x.id) < 0) d.plans_dirty.push(x.id);
      d.plans = d.plans.slice(-PLANS_MAX);
      write(d); changed();
      return x;
    },
    // Remove, and "We didn't go": the plan just goes, nothing marked
    removePlan: function (id) {
      var d = read();
      if (dropPlan(d, id)) { write(d); changed(); return true; }
      return false;
    },
    // ---- the mission you're on (site/js/current.js) ----
    current: function () { return read().settings.current || null; },
    // info: { mission, slug, name, pack, mode, setting, time_of_day, themes, steps }. Replaces any other current mission.
    start: function (info) {
      var d = read(), cur = cleanCurrent(Object.assign({}, info, { got: [], started_at: stamp() }));
      if (!cur) return null;
      d.settings.current = cur; prefsChanged(d);
      write(d); changed();
      track("mission_start", { mission_id: cur.slug });
      return cur;
    },
    stop: function () {
      var d = read();
      if (!d.settings.current) return;
      track("mission_cancel", { mission_id: d.settings.current.slug });
      delete d.settings.current; prefsChanged(d);
      write(d); changed();
    },
    // tick (or untick) photo prompt i
    got: function (i, yes) {
      var d = read(), cur = d.settings.current;
      if (!cur) return null;
      cur.got = cur.got.filter(function (x) { return x !== i; });
      if (yes) cur.got.push(i);
      d.settings.current = cleanCurrent(cur); prefsChanged(d);
      write(d); changed();
      return d.settings.current;
    },
    settings: function () { return read().settings; },
    // patch: { home_state?, anniversary?, display_name? }; null or "" clears one
    setSettings: function (patch) {
      var d = read(), next = Object.assign({}, d.settings);
      Object.keys(patch || {}).forEach(function (k) { if (patch[k] == null || patch[k] === "") delete next[k]; else next[k] = patch[k]; });
      d.settings = cleanSettings(next);
      prefsChanged(d);
      write(d); changed();
      return d.settings;
    },
    hide: function (id, yes) {
      var d = read();
      d.hidden = d.hidden.filter(function (x) { return x !== id; });
      if (yes) d.hidden.push(id);
      prefsChanged(d);
      write(d); changed();
    },
    // a backup code holds the whole list, so it can be pasted into another browser
    exportCode: function () {
      var json = JSON.stringify(read());
      var bytes = new TextEncoder().encode(json), bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return CODE_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    exportJson: function () { return JSON.stringify(read(), null, 1); },
    // Remove account: everything on this device goes (missions, Not for us, stamp settings, which stamps were seen)
    removeAll: function () {
      mem = null;
      try { localStorage.removeItem(KEY); localStorage.removeItem("amble.stamps.seen"); } catch (e) { /* private mode */ }
      write(empty()); changed();
    },
    // adds what's missing (the same mission on the same day counts as already there); returns how many were added
    importText: function (text) {
      text = String(text || "").trim();
      var data = null;
      try {
        if (text.indexOf(CODE_PREFIX) === 0) {
          var b64 = text.slice(CODE_PREFIX.length).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
          var bin = atob(b64 + "===".slice((b64.length + 3) % 4)), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          data = JSON.parse(new TextDecoder().decode(bytes));
        } else {
          data = JSON.parse(text);
        }
      } catch (e) { return null; }
      data = clean(data);
      if (!data) return null;
      var d = read();
      var day = function (c) { return c.mission + "|" + c.done_at.slice(0, 10); };
      var have = {};
      d.done.forEach(function (c) { have[day(c)] = 1; have["#" + c.rid] = 1; });
      var added = 0;
      data.done.forEach(function (c) {
        if (have[day(c)] || have["#" + c.rid]) return;
        have[day(c)] = 1;
        c.updated_at = stamp();
        d.done.push(c); dirty(d, c.rid); added++;
      });
      data.hidden.forEach(function (id) { if (d.hidden.indexOf(id) < 0) d.hidden.push(id); });
      Object.keys(data.settings).forEach(function (k) { if (!d.settings[k]) d.settings[k] = data.settings[k]; });   // what's set here wins
      var planned = {};
      d.plans.forEach(function (x) { planned[x.mission + "|" + x.day] = 1; planned["#" + x.id] = 1; });
      data.plans.forEach(function (x) {
        if (planned[x.mission + "|" + x.day] || planned["#" + x.id]) return;
        planned[x.mission + "|" + x.day] = 1;
        x.updated_at = stamp();
        d.plans.push(x); d.plans_dirty.push(x.id);
      });
      d.plans = d.plans.slice(-PLANS_MAX);
      prefsChanged(d);
      d.done = d.done.slice(-KEEP_MAX);
      write(d); changed();
      return { added: added, total: data.done.length };
    },
    box: box,
    skipButton: skipButton,
    // ---- for site/js/profile.js ----
    // what the profile doesn't have yet. all=true: everything (a profile just started, or opened on this device)
    pending: function (all) {
      var d = read();
      var want = {};
      (all ? d.done.map(function (c) { return c.rid; }) : d.dirty).forEach(function (r) { want[r] = 1; });
      var wantP = {};
      (all ? d.plans.map(function (x) { return x.id; }) : d.plans_dirty).forEach(function (r) { wantP[r] = 1; });
      return { done: d.done.filter(function (c) { return want[c.rid]; }), removed: all ? [] : d.removed.slice(),
               plans: d.plans.filter(function (x) { return wantP[x.id]; }), plans_removed: all ? [] : d.plans_removed.slice(),
               // settings go only if this device ever set any: a fresh device opening a profile link must not wipe the profile's
               prefs: d.prefs_dirty || (all && d.prefs_at) ? { hidden: d.hidden.slice(), settings: d.settings, at: d.prefs_at || stamp() } : null };
    },
    // the profile has these now: clear them, unless they changed again while it was saving
    sent: function (p) {
      var d = read();
      var at = {};
      p.done.forEach(function (c) { at[c.rid] = c.updated_at; });
      d.dirty = d.dirty.filter(function (r) {
        var c = d.done.find(function (x) { return x.rid === r; });
        return !(r in at) || (c && c.updated_at !== at[r]);
      });
      var gone = {};
      p.removed.forEach(function (r) { gone[r] = 1; });
      d.removed = d.removed.filter(function (r) { return !gone[r]; });
      if (p.prefs && d.prefs_at === p.prefs.at) d.prefs_dirty = false;
      var pat = {};
      (p.plans || []).forEach(function (x) { pat[x.id] = x.updated_at; });
      d.plans_dirty = d.plans_dirty.filter(function (r) {
        var x = d.plans.find(function (y) { return y.id === r; });
        return !(r in pat) || (x && x.updated_at !== pat[r]);
      });
      var pgone = {};
      (p.plans_removed || []).forEach(function (r) { pgone[r] = 1; });
      d.plans_removed = d.plans_removed.filter(function (r) { return !pgone[r]; });
      write(d);
    },
    // what the profile has that this device doesn't: newer edits win, removals are removals
    merge: function (res) {
      var d = read();
      var before = JSON.stringify([d.done, d.hidden, d.settings, d.plans]);
      var gone = {};
      (res.removed || []).forEach(function (r) { gone[r] = 1; });
      d.done = d.done.filter(function (c) { return !gone[c.rid]; });
      d.dirty = d.dirty.filter(function (r) { return !gone[r]; });
      (res.done || []).forEach(function (raw) {
        var c = cleanOne(raw);
        if (!c || gone[c.rid]) return;
        var i = d.done.findIndex(function (x) { return x.rid === c.rid; });
        if (raw && !("note" in raw)) c.note = i >= 0 ? d.done[i].note : "";   // the note couldn't be opened here: keep this device's
        if (i < 0) d.done.push(c);
        else if (d.dirty.indexOf(c.rid) < 0 || c.updated_at >= d.done[i].updated_at) d.done[i] = c;
      });
      var pat = res.prefs && res.prefs.at ? new Date(res.prefs.at) : null;   // the server writes times as +00:00, the browser as Z
      if (pat && !isNaN(pat.getTime()) && (!d.prefs_at || pat >= new Date(d.prefs_at)) && !d.prefs_dirty) {
        d.hidden = (res.prefs.hidden || []).filter(function (id) { return typeof id === "string" && ID_RE.test(id); });
        d.settings = cleanSettings(res.prefs.settings);
        d.prefs_at = pat.toISOString();
      }
      d.done = d.done.slice(-KEEP_MAX);
      // plans: the same rules (an older server sends none, which changes nothing)
      var pgone = {};
      (res.plans_removed || []).forEach(function (r) { pgone[r] = 1; });
      d.plans = d.plans.filter(function (x) { return !pgone[x.id]; });
      d.plans_dirty = d.plans_dirty.filter(function (r) { return !pgone[r]; });
      (res.plans || []).forEach(function (raw) {
        var x = cleanPlan(raw);
        if (!x || pgone[x.id]) return;
        var i = d.plans.findIndex(function (y) { return y.id === x.id; });
        if (i < 0) d.plans.push(x);
        else if (d.plans_dirty.indexOf(x.id) < 0 || x.updated_at >= d.plans[i].updated_at) d.plans[i] = x;
      });
      // a plan for a mission already done on or after its day clears itself
      d.plans.slice().forEach(function (x) {
        if (d.done.some(function (c) { return c.mission === x.mission && ymd(new Date(c.done_at)) >= x.day; })) dropPlan(d, x.id);
      });
      d.plans = d.plans.slice(-PLANS_MAX);
      write(d);
      if (JSON.stringify([d.done, d.hidden, d.settings, d.plans]) !== before) changed();
    },
  };
  window.AmbleDone = api;

  function track(name, params) { if (window.ambleTrack) window.ambleTrack(name, params); }

  // ---- the "Mark done" box under a mission ---------------------------------------------------------------
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function pretty(iso) { var t = new Date(iso); return MONTHS[t.getMonth()] + " " + t.getDate() + ", " + t.getFullYear(); }

  var ICONS = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    up: '<path d="M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z"/><path d="M7 10.5l3.6-6.6a1.8 1.8 0 0 1 3.3 1.3L13 9.5h5.4a2 2 0 0 1 2 2.4l-1.4 6.4a2 2 0 0 1-2 1.7H7"/>',
    down: '<path d="M7 13.5V4H4.5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1z"/><path d="M7 13.5l3.6 6.6a1.8 1.8 0 0 0 3.3-1.3L13 14.5h5.4a2 2 0 0 0 2-2.4l-1.4-6.4a2 2 0 0 0-2-1.7H7"/>',
  };
  function icon(name, size) {
    var t = document.createElement("template");
    t.innerHTML = '<svg aria-hidden="true" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return t.content.firstChild;
  }

  // info: { mission (full id), slug, name, pack, mode, setting, time_of_day, themes }
  // Each time you've done the mission is its own chip ("Done November 16, 2026") that opens to its day, rating and
  // note. The Mark done button stays, so doing it again adds another chip.
  function box(info) {
    var root = el("section", { class: "done-box", "aria-label": "Your log for this mission" });
    var live = el("p", { class: "sr", "aria-live": "polite" });
    function say(text) { live.textContent = ""; setTimeout(function () { live.textContent = text; }, 50); }
    // stamps earned by what was just done here land under the heading (site/js/stamps.js), and stay until the box goes
    var landed = [], landNow = false;
    function stampCheck() {
      if (!window.AmbleStamps) return "";
      var news = window.AmbleStamps.fresh();
      if (!news.length) return "";
      landed = news; landNow = true;
      return " " + (news.length === 1 ? "New stamp: " : "New stamps: ") + news.map(function (s) { return s.name; }).join(", ") + ".";
    }
    var open = {};   // which chips are open, kept across redraws

    // ---- Feedback for AmbleBee (claude/mission-feedback-PLAN.md): written TO the team, unlike the personal note ----
    // Optional, under the thumbs. Only if something was sent does it ask "Can AmbleBee use your feedback?", with
    // nothing pre-chosen. The personal note is never copied in or sent.
    var FB_API = U.API;
    var fb = {};   // per time done: {text, step: "write" | "ask" | "thanks", ref, error}
    function fbPost(path, body) {
      var h = Object.assign({ "Content-Type": "application/json" }, window.AmbleProfile && window.AmbleProfile.headers ? window.AmbleProfile.headers() : {});
      return fetch(FB_API + path, { method: "POST", headers: h, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { status: r.status, body: b }; }); },
              function () { return { status: 0, body: {} }; });
    }
    function feedbackBox(c) {
      var st = fb[c.rid] || (fb[c.rid] = { text: "", step: "write" });
      var up = c.rating === "up", id = "done-fb-" + c.rid;
      function redraw(focusSel) { draw(); var f = root.querySelector('[data-rid="' + c.rid + '"] ' + (focusSel || ".done-fb")); if (f) f.focus(); }
      var head = el("p", { class: "done-fb-label" }, el("b", { text: "Feedback for AmbleBee" }), el("span", { text: ": the AmbleBee team reads this" }));
      if (st.step === "thanks") {
        return el("div", { class: "done-fb", tabindex: "-1" }, head, el("p", { class: "done-fb-thanks", text: "Thank you! We read every one." }));
      }
      if (st.step === "ask") {
        function answer(use) {
          fbPost("/feedback/" + encodeURIComponent(st.ref) + "/consent", { use: use }).then(function () { st.step = "thanks"; redraw(); say("Thank you for your feedback."); });
        }
        return el("div", { class: "done-fb", role: "group", "aria-labelledby": id + "-ask", tabindex: "-1" }, head,
          el("p", { id: id + "-ask" }, el("b", { text: "Can AmbleBee use your feedback?" })),
          el("p", { class: "done-note-hint", text: "We'd quote it as \u201can AmbleBee user\u201d, never with your name. If it's about a problem, we may pass it on to the place so they can fix it. This is only about the feedback you just sent: your personal notes stay private." }),
          el("div", { class: "backup-row" },
            el("button", { type: "button", class: "btn small done-fb-yes", text: "Yes, you can use it", onclick: function () { answer(true); } }),
            el("button", { type: "button", class: "btn small done-fb-no", text: "No, just for you to read", onclick: function () { answer(false); } })));
      }
      var box = el("textarea", { id: id, maxlength: "2000", rows: "3", placeholder: up ? "What did you like?" : "What didn't work?",
        oninput: function (e) { st.text = e.target.value; send.disabled = !st.text.trim(); } });
      box.value = st.text;
      var send = el("button", { type: "button", class: "btn small primary done-fb-send", text: "Send to AmbleBee", onclick: function () {
        send.disabled = true;
        var info2 = { mission: c.mission, name: c.name, thumb: c.rating, text: st.text.trim() };
        fbPost("/feedback", info2).then(function (r) {
          if (r.status === 201 && r.body.ref) { st.ref = r.body.ref; st.step = "ask"; st.text = ""; st.error = ""; redraw(); return; }
          st.error = r.status === 0 ? "We couldn't reach AmbleBee. Try again in a bit." : ((r.body.errors && Object.values(r.body.errors)[0]) || r.body.error || "Something went wrong.");
          redraw("#" + id);
        });
      } });
      send.disabled = !st.text.trim();
      return el("div", { class: "done-fb" }, head,
        el("label", { for: id }, up ? "What did you like? " : "What didn't work? ", el("span", { class: "opt", text: "(optional)" })),
        box,
        el("p", { class: "done-note-hint", text: "We read every bit of feedback. A thumbs down tells us something needs fixing, a warning, or a better place, and if you loved it, we want to hear that too. Please leave out names and contact details." }),
        st.error ? el("p", { class: "form-status bad", role: "alert", text: st.error }) : null,
        el("div", { class: "backup-row" }, send));
    }

    function entry(c) {
      // when: today by default, or an earlier day for missions done before they were marked
      var dateId = "done-date-" + c.rid;
      var date = el("input", { id: dateId, type: "date", value: ymd(new Date(c.done_at)), max: ymd(new Date()), onchange: function (e) {
        var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value);
        if (!p) return;
        var was = new Date(c.done_at);
        var t = new Date(+p[1], +p[2] - 1, +p[3], was.getHours(), was.getMinutes());
        if (t > new Date()) return;
        api.update(c.rid, { done_at: t.toISOString() }); var got = stampCheck(); draw(); say("Date changed to " + pretty(t.toISOString()) + "." + got);
        var d = document.getElementById(dateId); if (d) d.focus();
      } });

      function rateBtn(value, label) {
        var on = c.rating === value;
        return el("button", { type: "button", class: "chip-btn" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick: function () {
          api.update(c.rid, { rating: on ? null : value });
          if (!on) track("mission_rated", { mission_id: c.slug, rating: value });
          draw(); var b = root.querySelector('[data-rid="' + c.rid + '"] [data-rate="' + value + '"]'); if (b) b.focus();
        }, "data-rate": value }, icon(value, 20), label);
      }
      var rate = el("fieldset", { class: "done-rate" }, el("legend", { text: "How was it?" }),
        el("div", { class: "done-rate-row" }, rateBtn("up", "Loved it"), rateBtn("down", "Not really")));

      var hidden = api.hidden().has(info.mission);
      var hide = c.rating === "down" || hidden ? el("label", { class: "check" },
        el("input", { type: "checkbox", checked: hidden, onchange: function (e) {
          api.hide(info.mission, e.target.checked);
          say(e.target.checked ? "We won't pick this one for you again." : "It can be picked for you again.");
        } }), "Not for us: don't pick this one for me again") : null;

      var asDate = info.mode === "both" ? el("label", { class: "check" },
        el("input", { type: "checkbox", checked: c.as_date, onchange: function (e) {
          api.update(c.rid, { as_date: e.target.checked }); var got = stampCheck(); if (got) { draw(); say(got.trim()); }
        } }),
        "We did this one as a date") : null;

      var noteId = "done-note-" + c.rid;
      var saveTimer = null;
      var note = el("textarea", { id: noteId, maxlength: String(NOTE_MAX), rows: "2", placeholder: "Who came, what you found, the best moment…",
        oninput: function (e) { clearTimeout(saveTimer); var v = e.target.value; saveTimer = setTimeout(function () { api.update(c.rid, { note: v }); }, 400); },
        onchange: function (e) { clearTimeout(saveTimer); api.update(c.rid, { note: e.target.value }); } });
      note.value = c.note;

      var bits = [];
      if (c.rating === "up") bits.push("Loved it");
      if (c.rating === "down") bits.push("Not really");
      if (c.note) bits.push("Note");
      var d = el("details", { class: "done-entry", "data-rid": c.rid, open: !!open[c.rid] },
        el("summary", {}, icon("check", 18), el("span", { class: "done-when" }, "Done ", el("time", { datetime: c.done_at, text: pretty(c.done_at) })),
          bits.length ? el("small", { text: bits.join(" · ") }) : null),
        el("div", { class: "done-entry-body" },
          el("div", { class: "done-grid" },
            el("div", { class: "done-field" }, el("label", { for: dateId, text: "Day you did it" }), date),
            rate),
          c.rating ? feedbackBox(c) : null,
          hide, asDate,
          el("div", { class: "done-field done-note" }, el("label", { for: noteId }, "Personal note: only you can read this ", el("span", { class: "opt", text: "(optional)" })), note,
            el("p", { class: "done-note-hint", text: "Kept on your device, and locked if you have a profile. AmbleBee never sees it." })),
          removeBit(c)));
      d.addEventListener("toggle", function () { if (d.open) open[c.rid] = 1; else delete open[c.rid]; });
      return d;
    }

    // Remove this one. If it would take back a stamp, it says which and asks first (it comes back if marked again).
    function removeBit(c) {
      var wrap = el("div", { class: "done-remove-wrap" });
      function go() {
        var lost = window.AmbleStamps ? window.AmbleStamps.wouldLose(c.rid).map(function (s) { return s.name; }) : [];
        api.remove(c.rid); delete open[c.rid]; landed = []; if (window.AmbleStamps) window.AmbleStamps.fresh();
        draw("mark");
        say("Removed the time you did it on " + pretty(c.done_at) + "." + (lost.length ? " Your " + (lost.length === 1 ? "stamp " : "stamps ") + lost.join(", ") + (lost.length === 1 ? " was" : " were") + " taken back too." : ""));
      }
      var btn = el("button", { type: "button", class: "linkish done-remove", onclick: function () {
        var lost = window.AmbleStamps ? window.AmbleStamps.wouldLose(c.rid) : [];
        if (!lost.length) { go(); return; }
        var names = lost.map(function (s) { return s.name; });
        var keep = el("button", { type: "button", class: "btn small done-remove-keep", text: "Keep it", onclick: function () { wrap.replaceChildren(btn); btn.focus(); } });
        wrap.replaceChildren(el("div", { class: "done-remove-sure", role: "group", "aria-label": "Remove this one?" },
          el("p", {}, el("b", { text: "This takes back " + (names.length === 1 ? "a stamp: " : names.length + " stamps: ") + names.join(", ") + "." }),
            " " + (names.length === 1 ? "It comes" : "They come") + " back if you mark it done again."),
          el("div", { class: "backup-row" },
            el("button", { type: "button", class: "btn small done-remove-yes", text: "Yes, remove it", onclick: go }), keep)));
        keep.focus();
      } }, "Remove this one");
      wrap.append(btn);
      return wrap;
    }

    // "Did you go?" (calendar-voting-PLAN.md, decision 35): a plan for this mission whose day has passed. Mark it done
    // marks it on that day (changeable after); We didn't go just clears the plan. Asked here only, never as a pop-up.
    function askPlan() {
      var p = api.plansFor(info.mission).filter(function (x) { return x.day && x.day < today(); })[0];
      if (!p) return null;
      var when = new Date(+p.day.slice(0, 4), +p.day.slice(5, 7) - 1, +p.day.slice(8, 10), p.time ? +p.time.slice(0, 2) : 12, p.time ? +p.time.slice(3) : 0);
      return el("div", { class: "plan-ask-box", role: "group", "aria-label": "Did you go?" },
        el("p", {}, "You planned this for " + (window.AmblePlans ? window.AmblePlans.prettyDay(p.day) : pretty(when.toISOString())) + ". ", el("b", { text: "Did you go?" })),
        el("div", { class: "plan-row-acts" },
          el("button", { type: "button", class: "btn small primary plan-yes", onclick: function () {
            var c = api.add(info, when); if (!c) return;
            open = {}; open[c.rid] = 1;
            var got = stampCheck(); draw("new");
            say("Marked done for " + pretty(c.done_at) + "." + got + " How was it?");
          } }, icon("check", 18), "Mark it done"),
          el("button", { type: "button", class: "btn small plan-no", onclick: function () {
            api.removePlan(p.id); draw("mark"); say("Cleared. Maybe next time.");
          } }, "We didn't go")));
    }

    function draw(focus) {
      if (root.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA" && !focus) return;   // don't redraw under someone typing
      var mine = api.forMission(info.mission);
      root.replaceChildren();
      root.classList.toggle("is-done", mine.length > 0);
      var ask = askPlan();
      if (ask) root.append(ask);
      var mark = el("button", { type: "button", class: "btn primary done-mark", onclick: function () {
        var c = api.add(info); if (!c) return;
        open = {}; open[c.rid] = 1;   // the new one opens, ready for how it went
        var got = stampCheck(); draw("new");
        say((mine.length ? "Marked done again." : "Marked done.") + got + " How was it?");
        if (window.AmbleProfile && !window.AmbleProfile.has()) window.AmbleProfile.offer(true);   // "Start a free profile?" (site/js/profile.js)
      } }, icon("check", 20), mine.length ? "Mark done again" : "Mark done");
      if (!mine.length) {
        var noStamps = !api.list().length;   // the first mission done earns First Steps, so no missions means no stamps yet
        root.append(el("p", { class: "done-lead" }, el("b", { text: "Did this one?" }), " Mark it done to keep track of it on this device."),
          noStamps ? el("p", { class: "done-stamp-hint", text: "Missions you mark done collect stamps in your stamp book." }) : "", mark, live);
        if (focus === "mark") mark.focus();
        return;
      }
      var head = el("h2", { class: "done-head", tabindex: "-1" }, icon("check", 22), el("span", {}, "Done",
        mine.length > 1 ? el("span", { class: "done-times", text: " · " + mine.length + " times" }) : null));
      var landing = landed.length && window.AmbleStamps ? window.AmbleStamps.landing(landed, landNow) : null;
      landNow = false;   // it lands once; later redraws (a rating, a note) show it standing still
      root.append.apply(root, [head, landing,
        el.apply(null, ["div", { class: "done-entries" }].concat(mine.map(entry))),
        el("div", { class: "done-foot" }, mark, el("a", { href: "/me/" }, "See your profile")),
        el("p", { class: "hint", text: window.AmbleProfile && window.AmbleProfile.has() ? "Saved to your profile." :
          "Saved on this device only. Start a free profile to keep it safe." }),
        live].filter(Boolean));   // landing is null when no stamp just landed
      if (focus === "new") { var s = root.querySelector(".done-entry summary"); if (s) s.focus(); }
      if (focus === "mark") mark.focus();
    }

    draw();
    window.addEventListener("amble:done", function () { if (root.isConnected) draw(); });
    window.addEventListener("storage", function (e) { if (e.key === KEY && root.isConnected) draw(); });   // another tab
    return root;
  }

  // ---- on mission cards, wherever cards show up (home, Every mission, packs, ideas): a "✓ Done" chip for missions
  //      you've done, and missions marked "Not for us" faded, keeping their place ----
  function cardSlug(a) {
    var m = /\/missions\/([a-z0-9-]+)\/?$/.exec(a.getAttribute("href") || "");
    return m ? m[1] : null;
  }
  function markCards(scope) {
    var cards = (scope || document).querySelectorAll ? (scope || document).querySelectorAll("a.card") : [];
    if (!cards.length) return;
    var d = read(), times = {}, skipped = {};
    d.done.forEach(function (c) { times[c.slug] = (times[c.slug] || 0) + 1; });
    d.hidden.forEach(function (id) { skipped[id.split("/")[1]] = 1; });
    Array.prototype.forEach.call(cards, function (a) {
      var slug = cardSlug(a), n = slug ? times[slug] || 0 : 0;
      var skip = !!(slug && skipped[slug]);
      if (a.classList.contains("is-skipped") !== skip) {
        a.classList.toggle("is-skipped", skip);
        var old = a.querySelector(".skip-chip");
        if (old) old.remove();
        if (skip) {
          var top = a.querySelector(".card-top");
          var chipS = el("span", { class: "skip-chip", title: "You marked this one Not for us. It's never picked for you." }, "Not for us");
          if (top) top.insertBefore(chipS, top.querySelector(".flags")); else a.prepend(chipS);
        }
      }
      var chip = a.querySelector(".done-chip");
      if (!n) { if (chip) chip.remove(); return; }
      var text = n > 1 ? "Done ×" + n : "Done";
      if (chip && chip.dataset.n === String(n)) return;
      if (chip) chip.remove();
      chip = el("span", { class: "done-chip", "data-n": String(n), title: n > 1 ? "You've done this " + n + " times" : "You've done this one" },
        icon("check", 14), el("span", { "aria-hidden": "true", text: text }), el("span", { class: "sr", text: n > 1 ? ", done " + n + " times" : ", done" }));
      var top = a.querySelector(".card-top");
      var flags = top && top.querySelector(".flags");
      if (top) top.insertBefore(chip, flags); else a.prepend(chip);
    });
  }
  function watchCards() {
    markCards(document);
    if (!window.MutationObserver) return;
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; markCards(document); });
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("amble:done", function () { markCards(document); });
    window.addEventListener("storage", function (e) { if (e.key === KEY) markCards(document); });
  }

  // ---- "Not for us" at the bottom of a mission, beside Report a problem: for missions you don't even want to try.
  //      The same list as the checkbox after "Not really"; it's never picked for you again on this device. ----
  function skipButton(id) {
    if (!ID_RE.test(id || "")) return null;
    var b = el("button", { type: "button", class: "btn small skip-btn" });
    function paint() {
      var on = api.hidden().has(id);
      b.replaceChildren(icon(on ? "check" : "x", 18), on ? "Not for us" : "Not for us");
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Marked Not for us: never picked for you. Tap to bring it back." : "Never pick this one for me";
    }
    b.addEventListener("click", function () {
      var on = !api.hidden().has(id);
      api.hide(id, on);
      if (on) track("mission_skipped", { mission_id: id.split("/")[1] });
      paint();
    });
    paint();
    window.addEventListener("amble:done", function () { if (b.isConnected) paint(); });
    window.addEventListener("storage", function (e) { if (e.key === KEY && b.isConnected) paint(); });
    return b;
  }

  // mission pages: <div class="done-slot" data-mission='{...}'></div>, filled in once the page is ready
  function mountSlots() {
    document.querySelectorAll(".done-slot[data-mission]").forEach(function (slot) {
      if (slot.firstChild) return;
      var info;
      try { info = JSON.parse(slot.getAttribute("data-mission")); } catch (e) { return; }
      if (!info || !ID_RE.test(info.mission || "")) return;
      slot.append(box(info));
      track("mission_opened", { mission_id: info.slug });
    });
    document.querySelectorAll(".skip-slot[data-mission]").forEach(function (slot) {
      if (!slot.firstChild) { var b = skipButton(slot.getAttribute("data-mission")); if (b) slot.append(b); }
    });
  }
  function start() { mountSlots(); watchCards(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
