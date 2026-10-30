/* AmbleBee Missions: picks and shows missions from catalog.json (built from missions/ by the GitHub Action).
   Everything runs in the visitor's browser. Nothing is sent anywhere; location stays in the tab.

   The site's script is split across site/js/, loaded in order from index.html, sharing one scope:
   core, filters, ticket, gift, image, reveal, browse, main. */
"use strict";


// ---- settings you might edit -----------------------------------------------------------------
const FORM_URL = "https://forms.gle/V8UZRwmDrLwzQpuM6";   // "Suggest a mission"
const REPO_URL = "https://github.com/AmbleBee/amblebee-missions";
// "Report a problem" form: opens with the mission's id and name already filled in.
// Use the long docs.google.com/forms/.../viewform address (short forms.gle links can't pre-fill).
const REPORT_FORM = "https://docs.google.com/forms/d/e/1FAIpQLSesllGRZbJaA4nINHJnwgmJxMIFX4z1aI88puOSOCUmzrnfHQ/viewform";
const REPORT_FIELDS = { id: "entry.872618061", name: "entry.160884926" };

// ---- labels ---------------------------------------------------------------------------------
const L = {
  mode: { date: "Date", adventure: "Adventure", both: "Date or adventure" },
  duration: { short: "1-3 hours", "half-day": "Half day", "all-day": "All day" },
  effort: { easy: "Easy", moderate: "Moderate", hard: "Hard" },
  cost: { free: "Free", "$": "Under $20", "$$": "$20-60", "$$$": "Over $60" },
  setting: { indoor: "Indoors", outdoor: "Outdoors", either: "Indoors or out" },
  time: { morning: "Best in the morning", daytime: "Daytime", evening: "Best in the evening", night: "At night" },
  check: { hours: "opening hours", tickets: "tickets", reservation: "a reservation", seasonal: "whether it's open this season", conditions: "weather and trail conditions" },
  who: { solo: "just you", friends: "friends", family: "family", kids: "kids" },
  // discounts a place offers, shown as "Ask about discounts: …" (never promised: prices change)
  discount: { senior: "seniors", military: "military and veterans", "first-responder": "first responders",
    healthcare: "healthcare workers", educator: "teachers and educators", student: "students",
    government: "government employees", local: "local residents", birthday: "birthdays" },
};
const NAME_MAX = 30;    // "From" and "To" on a gift link
const NOTE_MAX = 400;   // the hidden note
// how the note card is signed. Links store only the short key, so a link can't put anything else here.
const SIGNOFF = {
  xo: "xo,", love: "Love,", luv: "Love you,", yours: "Yours,", miss: "Miss you,",
  fun: "Have fun!", cheers: "Cheers,", bud: "Your adventure buddy,", see: "See you there!",
  wl: "With love,", always: "Love always,", hugs: "Hugs,", best: "Best wishes,",
  none: "(no sign-off)",
};
// card themes: each has its own look and its own sign-offs (the first is the default)
const THEMES = {
  partner: { label: "Partner", icon: "heart", signs: ["xo", "love", "luv", "yours", "miss", "none"] },
  friend: { label: "Friend", icon: "daisy", signs: ["fun", "cheers", "bud", "see", "xo", "none"] },
  family: { label: "Family", icon: "hive", signs: ["love", "wl", "always", "hugs", "best", "none"] },
};
const CARD_ART = {   // fixed artwork for the corner of each card
  heart: '<svg viewBox="0 0 28 26" width="34" height="32"><path d="M9 21 C4 17 2 14 2 10.5 A4.5 4.5 0 0 1 9 7 A4.5 4.5 0 0 1 16 10.5 C16 14 14 17 9 21z" fill="#D98C7E"/><ellipse cx="20" cy="6" rx="2.6" ry="1.8" fill="#FFFDF8" stroke="#7A5A42" stroke-width=".9" transform="rotate(-25 20 6)"/><ellipse cx="21.3" cy="9" rx="3.4" ry="2.5" fill="#E8B54A"/><path d="M20.6 6.8 v4.4 M22.4 7 v4" stroke="#5A3E2B" stroke-width="1"/><circle cx="24.4" cy="8.7" r="1.5" fill="#5A3E2B"/><path d="M15 15 q3 -1 4 -4" fill="none" stroke="#7A5A42" stroke-width=".8" stroke-dasharray="1 1.6"/></svg>',
  daisy: '<svg viewBox="0 0 28 26" width="34" height="32"><g transform="translate(9 15)"><g fill="#FFFDF8" stroke="#A3B18A" stroke-width=".9"><ellipse cx="0" cy="-5" rx="2.4" ry="3.6"/><ellipse cx="0" cy="5" rx="2.4" ry="3.6"/><ellipse cx="-5" cy="0" rx="3.6" ry="2.4"/><ellipse cx="5" cy="0" rx="3.6" ry="2.4"/><ellipse cx="-3.6" cy="-3.6" rx="2.2" ry="3.2" transform="rotate(-45 -3.6 -3.6)"/><ellipse cx="3.6" cy="3.6" rx="2.2" ry="3.2" transform="rotate(-45 3.6 3.6)"/><ellipse cx="3.6" cy="-3.6" rx="2.2" ry="3.2" transform="rotate(45 3.6 -3.6)"/><ellipse cx="-3.6" cy="3.6" rx="2.2" ry="3.2" transform="rotate(45 -3.6 3.6)"/></g><circle r="2.6" fill="#E8B54A"/></g><ellipse cx="20" cy="4.6" rx="2.6" ry="1.8" fill="#FFFDF8" stroke="#7A5A42" stroke-width=".9" transform="rotate(-25 20 4.6)"/><ellipse cx="21.3" cy="7.6" rx="3.4" ry="2.5" fill="#E8B54A"/><path d="M20.6 5.4 v4.4 M22.4 5.6 v4" stroke="#5A3E2B" stroke-width="1"/><circle cx="24.4" cy="7.3" r="1.5" fill="#5A3E2B"/></svg>',
  hive: null,   // the AmbleBee hive + bee (BEE), filled in where it's used
};
const themeOf = (k) => (THEMES[k] ? k : "partner");
const signFor = (theme, s) => (THEMES[theme].signs.includes(s) ? s : THEMES[theme].signs[0]);
// "Check before you go: …" — a fixed order with the season check last, and a comma before the final "and"
// when the list is long or an item already has an "and" in it ("weather and trail conditions").
const CHECK_ORDER = ["hours", "tickets", "reservation", "conditions", "seasonal"];
function checkText(m) {
  const keys = [...new Set(m.check_ahead || [])].sort((a, b) => {
    const i = (k) => (CHECK_ORDER.includes(k) ? CHECK_ORDER.indexOf(k) : 99);
    return i(a) - i(b);
  });
  return joinList(keys.map((k) => L.check[k] || k));
}
function joinList(parts) {
  if (parts.length < 2) return parts.join("");
  const comma = parts.length > 2 || parts.some((t) => / and /.test(t));
  return parts.slice(0, -1).join(", ") + (comma ? ", and " : " and ") + parts[parts.length - 1];
}
// "caution" (one short warning, website only) shows until the end of its caution_until day, if it has one.
// Dates are compared as YYYY-MM-DD text in the visitor's own time zone.
function cautionText(m) {
  const text = typeof m.caution === "string" ? m.caution.trim() : "";
  if (!text) return null;
  const until = typeof m.caution_until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.caution_until) ? m.caution_until : null;
  if (until) {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (today > until) return null;
  }
  return text;
}
const DISCOUNT_ORDER = ["senior", "military", "first-responder", "healthcare", "educator", "student", "government", "local", "birthday"];
function discountText(m) {
  const keys = [...new Set(m.discounts || [])].sort((a, b) => DISCOUNT_ORDER.indexOf(a) - DISCOUNT_ORDER.indexOf(b));
  return joinList(keys.map((k) => L.discount[k] || k));
}
const NEAR_MAX = 24;
const NEARBY_SHARE = 0.75;      // with a ZIP set, how often a pick is a real place nearby
const NEARBY_M = 160934;        // "nearby" when no distance is picked: 100 miles
const WITHIN = { mi: [5, 15, 30, 60, 100], km: [10, 25, 50, 100, 150] };
const M_PER = { mi: 1609.344, km: 1000 };

// one quiet line for screen readers: the latest result count, after things settle
let announceTimer = null;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { $("#live").textContent = text; }, 500);
}

// ---- tiny DOM helper (text is always set as text, never as HTML) ---------------------------------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function svg(markup, size = 22) {
  const t = document.createElement("template");
  t.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
  return t.content.firstChild;
}
const ICON = {   // interface artwork only (never mission data). Pack icons come from icons/packs/ via icons.json
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.6 1.6 0 0 1 0 2.2l-6.6 6.6a1.6 1.6 0 0 1-2.2 0z"/><circle cx="8" cy="8" r="1.5"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  caution: '<path d="M10.3 4.3L2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 17h.01"/>',
};
// pack icons: icons.json is built from icons/packs/*.svg by tools/build_icons.py (checked to be plain shapes)
// the website's own markers come from icons/site/ (also via icons.json); the fallbacks keep cards working without it
const siteIcon = (name, fallback) => (S.siteIcons && Object.prototype.hasOwnProperty.call(S.siteIcons, name) && S.siteIcons[name]) || fallback;
const packIcon = (p) => (S.icons && p && Object.prototype.hasOwnProperty.call(S.icons, p.icon) && S.icons[p.icon]) || ICON.compass;

// ---- state ---------------------------------------------------------------------------------------
const S = {
  catalog: null, missions: [], packs: [], packById: {},
  current: null,
  unit: readPref("unit") || (/^en-US/.test(navigator.language || "") ? "mi" : "km"),
  here: null,   // {lat, lon} of the ZIP: in memory only, never stored or sent
  zip: null,
  zips: null,   // ZIP -> [lat, lon], downloaded whole the first time someone sets a ZIP
  browse: null, // which pack "Every mission" shows ("all", "near", or a pack id)
  q: "",        // search box text ("" = not searching)
};
function readPref(k) { try { return localStorage.getItem("amble." + k); } catch (e) { return null; } }
function dropPref(k) { try { localStorage.removeItem("amble." + k); } catch (e) { /* private mode: fine */ } }
function writePref(k, v) { try { localStorage.setItem("amble." + k, v); } catch (e) { /* private mode: fine */ } }

// ---- helpers ------------------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const SITE_NAME = "AmbleBee Missions";
const HOME = location.pathname.replace(/[^/]*$/, "");   // the home page's path, even while a pop-up has its own address
const pretty = (s) => String(s).replace(/-/g, " ");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function prettyDate(iso) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return p ? new Date(+p[1], p[2] - 1, +p[3]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "recently";
}
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u)) ? u : null;
const coordsOf = (m) => {
  const c = m.place && m.place.coords;
  return Array.isArray(c) && c.length === 2 && c.every((v) => typeof v === "number") ? c : null;
};
function seasonNow() {
  const mo = new Date().getMonth();
  return ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "fall", "fall", "fall", "winter"][mo];
}
// when a mission's time_of_day fits, in 24-hour clock hours; night runs past midnight to 5am
const TIME_WINDOW = { morning: [5, 11], daytime: [9, 18], evening: [16, 22], night: [19, 29] };
function rightTime(m, hour) {
  const w = TIME_WINDOW[m.time_of_day];
  return !w || (hour >= w[0] && hour < w[1]) || (hour + 24 >= w[0] && hour + 24 < w[1]);
}
const inSeason = (m) => m.season === "any" || (m.season || []).includes(seasonNow());
function meters(a, b) {   // haversine: straight line, "as the bee flies"
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function distM(m) { const c = coordsOf(m); return (c && S.here) ? meters([S.here.lat, S.here.lon], c) : null; }
function fmtDist(mt) {
  const v = mt / M_PER[S.unit];
  if (v < 0.1) return `under 0.1 ${S.unit}`;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${S.unit}`;
}
