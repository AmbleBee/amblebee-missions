/* Stamps: worked out in this browser from the missions you've marked done (site/js/done.js).
   Nothing is stored about stamps themselves: they're rebuilt from the completions every time, so they can
   never drift from your list. The rules follow the stamp book (claude/stamp-book.md in the project):
     - each completion carries a snapshot of the mission as it was, so later edits to a mission never change a stamp
     - seasons come from the day you did it (spring Mar-May, summer Jun-Aug, fall Sep-Nov, winter Dec-Feb)
     - a date mission is mode "date", or a "both" mission done as a date
     - "5 of a kind" counts different missions; repeats count for Old Favorites
   No streaks, no "3 more to go": the book only ever shows stamps you've earned, plus plain empty spots.

   Website stamps are the starter set minus the three that need photos (those are Hive only).
   Our Year of Adventures is one stamp per calendar year from 2026 on, earned with that year's first mission; it carries
   how many missions were done that year (year_count), which keeps growing as the year goes on.
   window.AmbleStamps: { all, pages, states, compute(list, settings), earned(), fresh(), landing(news) } */
(function () {
  "use strict";

  // id, name, the book page it sits on. Listed in the order stamps from the same completion are inked in.
  var STAMPS = [
    { id: "first-steps", name: "First Steps", page: "firsts" },
    { id: "our-year", name: "Our Year of Adventures", page: "memories", yearly: true },
    { id: "lovebirds", name: "Lovebirds", page: "firsts" },
    { id: "road-tripper", name: "Road Tripper", page: "places" },
    { id: "home-sweet-home", name: "Home Sweet Home", page: "places" },
    { id: "spring-has-sprung", name: "Spring Has Sprung", page: "seasons" },
    { id: "summer-lovin", name: "Summer Lovin'", page: "seasons" },
    { id: "fall-into-adventure", name: "Fall Into Adventure", page: "seasons" },
    { id: "winter-wonderland", name: "Winter Wonderland", page: "seasons" },
    { id: "master-of-the-seasons", name: "Master of the Seasons", page: "seasons" },
    { id: "our-anniversary", name: "Our Anniversary", page: "together" },
    { id: "old-favorites", name: "Old Favorites", page: "together" },
  ];
  // count milestones: surprises, never shown ahead. First Steps is the first one.
  var MILESTONES = [10, 25, 50, 100, 200, 500, 1000];
  MILESTONES.forEach(function (n) { STAMPS.push({ id: "milestone-" + n, name: n.toLocaleString("en-US") + " Missions", page: "memories", count: n }); });
  var PAGES = [
    { id: "firsts", name: "Firsts" }, { id: "places", name: "Places" }, { id: "together", name: "Together" },
    { id: "seasons", name: "Seasons" }, { id: "memories", name: "Memories" },
  ];
  var BY_ID = {};
  STAMPS.forEach(function (s, i) { s.rank = i; BY_ID[s.id] = s; });

  // the state packs, for Home Sweet Home's setting (pack id -> name). Amble Anywhere isn't a state.
  var STATES = {};
  ("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana " +
   "iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska " +
   "nevada new-hampshire new-jersey new-mexico new-york north-carolina north-dakota ohio oklahoma oregon pennsylvania " +
   "rhode-island south-carolina south-dakota tennessee texas utah vermont virginia washington west-virginia wisconsin wyoming")
    .split(" ").forEach(function (id) {
      STATES[id] = id.split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
    });

  var YEAR_ART = { from: 2026, to: 2030 };   // site/stamps/our-year-<year>.svg, a new scene each year; later years use the plain our-year.svg until theirs is drawn
  var FIRST_YEAR = 2026;                       // AmbleBee's first year: earlier years have passed and can't be earned (back-dated missions still count for everything else)
  var SEASON_OF_MONTH = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"];
  var SEASON_STAMP = { spring: "spring-has-sprung", summer: "summer-lovin", fall: "fall-into-adventure", winter: "winter-wonderland" };
  var OF_A_KIND = 5, HOME_COUNT = 10, STATE_COUNT = 3;

  function isDate(c) { return (c.snapshot && c.snapshot.mode === "date") || c.as_date === true; }
  function mmdd(t) { return ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2); }
  function leap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function onAnniversary(t, ann) {
    if (!ann) return false;
    var d = mmdd(t);
    return d === ann || (ann === "02-29" && d === "02-28" && !leap(t.getFullYear()));   // Feb 29 counts on Feb 28 other years
  }

  // list: completions (any order). settings: { home_state, anniversary: "MM-DD" }.
  // Returns earned stamps, oldest first: { key, id, name, page, year?, art, mission, slug, name_of_mission, earned_at, rid }
  function compute(list, settings) {
    settings = settings || {};
    var home = STATES[settings.home_state] ? settings.home_state : null;
    var done = (list || []).slice().sort(function (a, b) {
      return a.done_at < b.done_at ? -1 : a.done_at > b.done_at ? 1 : a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0;
    });
    var out = [], got = {};
    var count = 0, seenMission = {}, timesByMission = {}, repeated = 0;
    var statePacks = {}, nStates = 0, stateOrder = [], homeMissions = {}, nHome = 0;
    var bySeason = { spring: {}, summer: {}, fall: {}, winter: {} }, nSeason = { spring: 0, summer: 0, fall: 0, winter: 0 };
    var seasonsSeen = {}, nSeasonsSeen = 0;
    var perYear = {};

    done.forEach(function (c) {
      var t = new Date(c.done_at);
      if (isNaN(t.getTime())) return;
      var s = c.snapshot || {};
      var season = SEASON_OF_MONTH[t.getMonth()];
      var year = t.getFullYear();
      count++;
      perYear[year] = (perYear[year] || 0) + 1;
      timesByMission[c.mission] = (timesByMission[c.mission] || 0) + 1;
      if (timesByMission[c.mission] === 2) repeated++;
      seenMission[c.mission] = 1;
      if (s.pack && STATES[s.pack] && !statePacks[s.pack]) { statePacks[s.pack] = 1; nStates++; stateOrder.push(STATES[s.pack]); }
      if (home && s.pack === home && !homeMissions[c.mission]) { homeMissions[c.mission] = 1; nHome++; }
      if (!bySeason[season][c.mission]) { bySeason[season][c.mission] = 1; nSeason[season]++; }
      if (!seasonsSeen[season]) { seasonsSeen[season] = 1; nSeasonsSeen++; }

      var now = [];
      function earn(id, year) {
        var key = year ? id + "-" + year : id;
        if (got[key]) return;
        got[key] = 1;
        now.push({ id: id, key: key, year: year || null });
      }
      if (count >= 1) earn("first-steps");
      if (year >= FIRST_YEAR) earn("our-year", year);
      if (isDate(c)) earn("lovebirds");
      if (nStates >= STATE_COUNT) earn("road-tripper");
      if (home && nHome >= HOME_COUNT) earn("home-sweet-home");
      Object.keys(SEASON_STAMP).forEach(function (k) { if (nSeason[k] >= OF_A_KIND) earn(SEASON_STAMP[k]); });
      if (nSeasonsSeen === 4) earn("master-of-the-seasons");
      if (isDate(c) && onAnniversary(t, settings.anniversary)) earn("our-anniversary");
      if (repeated >= OF_A_KIND) earn("old-favorites");
      MILESTONES.forEach(function (n) { if (count >= n) earn("milestone-" + n); });

      var ctx = { year: year, season: season, states: stateOrder.slice(0, STATE_COUNT), home: home && STATES[home], t: t };
      now.sort(function (a, b) { return BY_ID[a.id].rank - BY_ID[b.id].rank; }).forEach(function (n) {
        var def = BY_ID[n.id];
        out.push({
          how: how(n.id, ctx),
          key: n.key, id: n.id, page: def.page, year: n.year,
          name: def.yearly ? def.name + ": " + n.year : def.name,
          art: art(n),
          mission: c.mission, slug: c.slug, mission_name: c.name,
          earned_at: c.done_at, rid: c.rid,
        });
      });
    });
    out.forEach(function (st) { if (st.year) st.year_count = perYear[st.year]; });
    return out;
  }

  // How it was earned, shown once you have it (never before: no locked list). Uses your own details where it can.
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function andList(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function how(id, c) {
    var m = /^milestone-(\d+)$/.exec(id);
    if (m) return "Your " + (+m[1]).toLocaleString("en-US") + "th mission done. Every time out counts, repeats too.";
    switch (id) {
      case "first-steps": return "Your very first mission marked done.";
      case "our-year": return "Your first mission of " + c.year + ". The count under it keeps growing with every mission that year.";
      case "lovebirds": return "Your first date mission (or one you did as a date).";
      case "road-tripper": return "Missions in three different states: " + andList(c.states) + ".";
      case "home-sweet-home": return "Ten different missions in your home state, " + c.home + ".";
      case "spring-has-sprung": case "summer-lovin": case "fall-into-adventure": case "winter-wonderland":
        return "Five different missions done in " + c.season + ".";
      case "master-of-the-seasons": return "A mission in every season: spring, summer, fall and winter.";
      case "our-anniversary": return "A date mission on your anniversary, " + MONTH_NAMES[c.t.getMonth()] + " " + c.t.getDate() + ".";
      case "old-favorites": return "Five different missions you went back and did again.";
    }
    return "";
  }

  function art(n) {
    if (n.id === "our-year") {
      var y = n.year;
      return "/stamps/" + (y >= YEAR_ART.from && y <= YEAR_ART.to ? "our-year-" + y : "our-year") + ".svg";
    }
    return "/stamps/" + n.id + ".svg";
  }

  function settings() { return window.AmbleDone && window.AmbleDone.settings ? window.AmbleDone.settings() : {}; }
  // the stamps that removing this one time would take back (they come back if it's marked done again)
  function wouldLose(rid) {
    if (!window.AmbleDone) return [];
    var list = window.AmbleDone.list();
    var after = {};
    compute(list.filter(function (c) { return c.rid !== rid; }), settings()).forEach(function (s) { after[s.key] = 1; });
    return compute(list, settings()).filter(function (s) { return !after[s.key]; });
  }
  function earned() { return window.AmbleDone ? compute(window.AmbleDone.list(), settings()) : []; }

  // ---- which stamps have already been shown, so only new ones land ----
  var SEEN_KEY = "amble.stamps.seen";
  var memSeen = null;
  function readSeen() {
    try { var raw = localStorage.getItem(SEEN_KEY); if (raw != null) return JSON.parse(raw); } catch (e) { /* private mode */ }
    return memSeen;
  }
  function writeSeen(keys) {
    memSeen = keys;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(keys)); } catch (e) { /* in memory, then */ }
  }
  // Stamps earned since the last look. The first time this browser sees stamps.js, everything already earned
  // counts as seen, so nobody gets a flood of stamps landing at once.
  function fresh() {
    var now = earned();
    var seen = readSeen();
    var keys = now.map(function (s) { return s.key; });
    writeSeen(keys);   // also drops stamps that went away with an Undo, so they land again if re-earned
    if (!Array.isArray(seen)) return [];
    var had = {};
    seen.forEach(function (k) { had[k] = 1; });
    return now.filter(function (s) { return !had[s.key]; });
  }
  if (!Array.isArray(readSeen())) writeSeen(earned().map(function (s) { return s.key; }));

  // ---- the moment a stamp lands (under the Mark done box) ----
  function landing(news, animate) {
    if (!news || !news.length) return null;
    var box = document.createElement("div");
    box.className = "stamp-landing";
    var row = document.createElement("div");
    row.className = "stamp-landing-art";
    news.slice(0, 3).forEach(function (s, i) {
      var img = document.createElement("img");
      img.src = s.art; img.alt = ""; img.width = 92; img.height = 120;
      img.className = "stamp-img" + (animate ? " lands" : "");
      if (animate) img.style.animationDelay = (i * 0.18) + "s";
      row.append(img);
    });
    var text = document.createElement("p");
    var b = document.createElement("b");
    b.textContent = news.length === 1 ? "New stamp!" : news.length + " new stamps!";
    text.append(b, " " + news.map(function (s) { return s.name; }).join(", "));
    var link = document.createElement("a");
    link.href = "/me/"; link.textContent = "Open your stamp book";
    var words = document.createElement("div");
    words.append(text, link);
    box.append(row, words);
    return box;
  }

  window.AmbleStamps = {
    all: STAMPS, pages: PAGES, states: STATES,
    compute: compute, earned: earned, fresh: fresh, landing: landing, wouldLose: wouldLose,
  };
})();
