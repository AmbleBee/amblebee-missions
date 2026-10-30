/* AmbleBee Missions: picks and shows missions from catalog.json (built from missions/ by the GitHub Action).
   Everything runs in the visitor's browser. Nothing is sent anywhere; location stays in the tab. */
"use strict";

// ---- settings you might edit -----------------------------------------------------------------
const FORM_URL = "https://forms.gle/V8UZRwmDrLwzQpuM6";   // paste the Google Form link here when it's ready; until then the button explains
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
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
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
function writePref(k, v) { try { localStorage.setItem("amble." + k, v); } catch (e) { /* private mode: fine */ } }

// ---- helpers ------------------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const pretty = (s) => String(s).replace(/-/g, " ");
const list = (arr) => arr.length < 2 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
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

// ---- filters ------------------------------------------------------------------------------------
function readFilters() {
  const checked = (name) => [...document.querySelectorAll(`[data-filter="${name}"] input:checked`)].map((i) => i.value);
  return {
    mode: (document.querySelector('input[name="mode"]:checked') || {}).value || "any",
    pack: $("#pack-select").value,
    who: checked("who"), duration: checked("duration"), effort: checked("effort"),
    cost: checked("cost"), setting: checked("setting"), themes: checked("themes"),
    inSeason: $("#f-season").checked, goNow: $("#f-gonow").checked, hour: new Date().getHours(),
    within: $("#within-select").value ? Number($("#within-select").value) : null,
  };
}
function passes(m, f) {
  if (f.mode === "date" && !["date", "both"].includes(m.mode)) return false;
  if (f.mode === "adventure" && !["adventure", "both"].includes(m.mode)) return false;
  if (f.pack !== "all" && m.pack !== f.pack) return false;
  if (f.who.length && !f.who.every((w) => (m.who || []).includes(w))) return false;
  if (f.duration.length && !f.duration.includes(m.duration)) return false;
  if (f.effort.length && !f.effort.includes(m.effort)) return false;
  if (f.cost.length && !f.cost.includes(m.cost)) return false;
  if (f.setting.length && m.setting !== "either" && !f.setting.includes(m.setting)) return false;
  // themes: any of the picked ones (Food or Views), so picking more widens rather than narrows
  if (f.themes.length && !(m.themes || []).some((t) => f.themes.includes(t))) return false;
  if (f.inSeason && !inSeason(m)) return false;
  if (f.goNow && ((m.check_ahead || []).some((c) => c === "tickets" || c === "reservation")
    || !inSeason(m) || !rightTime(m, f.hour))) return false;
  if (f.within != null) { const d = distM(m); if (d != null && d > f.within * M_PER[S.unit]) return false; }
  return true;
}
function activeFilters(f) {
  return f.who.length + f.duration.length + f.effort.length + f.cost.length + f.setting.length + f.themes.length
    + (f.inSeason ? 1 : 0) + (f.goNow ? 1 : 0);
}
const pool = () => { const f = readFilters(); return S.missions.filter((m) => passes(m, f)); };

// ---- the ticket ---------------------------------------------------------------------------------
function ticket(m, { titleId } = {}) {
  const pack = S.packById[m.pack] || { name: m.pack };
  const isKids = (m.who || []).includes("kids") && m.for_kids;

  const tags = [
    h("li", { class: "sage" }, L.mode[m.mode] || m.mode),
    h("li", {}, L.duration[m.duration] || m.duration),
    h("li", {}, L.effort[m.effort] || m.effort),
    h("li", {}, L.cost[m.cost] || m.cost),
    h("li", {}, L.setting[m.setting] || m.setting),
    m.season && m.season !== "any" ? h("li", { class: "honey" }, cap(list(m.season))) : null,
    L.time[m.time_of_day] ? h("li", {}, L.time[m.time_of_day]) : null,
  ];

  const notes = [];
  if (m.who && m.who.length) {
    notes.push(h("p", {}, svg(ICON.compass, 18), `Good with ${list(m.who.map((w) => L.who[w] || w))}`));
  }
  if (m.check_ahead && m.check_ahead.length) {
    notes.push(h("p", {}, svg(ICON.clock, 18), `Check before you go: ${checkText(m)}`));
  }
  if (m.discounts && m.discounts.length) {
    notes.push(h("p", {}, svg(ICON.tag, 18), `Ask about discounts: ${discountText(m)}`));
  }
  if (m.gear && m.gear.length) {
    const bring = m.gear.filter((g) => !g.rent || g.rent === "no").map((g) => pretty(g.item));
    const there = m.gear.filter((g) => g.rent === "on-site").map((g) => pretty(g.item));
    const near = m.gear.filter((g) => g.rent === "nearby").map((g) => pretty(g.item));
    const bits = [];
    if (bring.length) bits.push(`Bring ${list(bring)}`);
    if (there.length) bits.push(`${bring.length ? "rent" : "Rent"} ${list(there)} there`);
    if (near.length) bits.push(`${bits.length ? "rent" : "Rent"} ${list(near)} nearby`);
    notes.push(h("p", {}, svg(ICON.bag, 18), bits.join("; ")));
  }

  const warn = cautionText(m);
  const caution = warn ? h("div", { class: "caution", role: "note", "aria-label": "Caution" }, svg(ICON.caution, 20), h("p", {}, warn)) : null;

  let place = null;
  const c = coordsOf(m);
  if (m.place) {
    const d = distM(m);
    const links = [];
    if (c) {
      links.push(h("a", { href: `https://www.google.com/maps/search/?api=1&query=${c[0]},${c[1]}`, target: "_blank", rel: "noopener" }, svg(ICON.map, 18), "Google Maps"));
      links.push(h("a", { href: `https://maps.apple.com/?ll=${c[0]},${c[1]}&q=${encodeURIComponent(m.place.name || m.name)}`, target: "_blank", rel: "noopener" }, svg(ICON.map, 18), "Apple Maps"));
    }
    const site = safeUrl(m.place.website);
    if (site) links.push(h("a", { href: site, target: "_blank", rel: "noopener" }, svg(ICON.link, 18), "Website"));
    // optional extra links (place.links: [{label, url}]), e.g. a bike rental next to the island's own site
    for (const l of (Array.isArray(m.place.links) ? m.place.links : []).slice(0, 3)) {
      const url = safeUrl(l && l.url), label = l && String(l.label || "").trim();
      if (url && label) links.push(h("a", { href: url, target: "_blank", rel: "noopener" }, svg(ICON.link, 18), label));
    }
    place = h("div", { class: "place" },
      h("span", {}, svg(ICON.pin, 18), " ", h("b", {}, m.place.name || ""), m.place.area ? `, ${m.place.area}` : ""),
      m.place.address ? h("span", {}, m.place.address) : null,
      d != null ? h("span", { class: "dist" }, `${fmtDist(d)} from ${S.zip} as the bee flies`) : null,
      links.length ? h("div", { class: "links" }, links) : null);
  }

  const extras = [];
  if (m.steps && m.steps.length) {
    extras.push(h("details", { class: "extra" }, h("summary", {}, "Photo prompts along the way"),
      h("div", { class: "inner" }, h("ol", {}, m.steps.map((s) => h("li", {}, s))))));
  }
  if (isKids) {
    extras.push(h("details", { class: "extra" }, h("summary", {}, "Kids' version"),
      h("div", { class: "inner" }, h("p", { style: "margin:0;font-weight:800" }, m.for_kids.short),
        h("ol", {}, (m.for_kids.steps || []).map((s) => h("li", {}, s))))));
  }

  return h("article", { class: "ticket" },
    h("div", { class: "stub" }, svg(packIcon(pack), 34),
      h("span", { class: "lbl" }, "Mission"), h("span", { class: "num" }, m.number || "?")),
    h("div", { class: "body" },
      h("h3", { id: titleId || null }, m.name),
      String(m.credit || "").trim() ? h("p", { class: "credit" }, "Suggested by ", String(m.credit).trim()) : null,
      h("p", { class: "short" }, m.short),
      m.description ? h("p", { class: "desc" }, m.description) : null,
      h("ul", { class: "tags", "aria-label": "Details" }, tags),
      notes.length ? h("div", { class: "notes" }, notes) : null,
      caution, place, extras,
      h("p", { class: "source" }, svg(packIcon(pack), 18),
        h("span", {}, "Mission ", h("b", {}, String(m.number || "?")), " in ", h("b", {}, pack.name)),
        h("code", {}, m.full_id)),
      reportUrl(m) ? h("p", { class: "report" }, "Closed, moved or something off? ",
        h("a", { href: reportUrl(m), target: "_blank", rel: "noopener" }, "Report a problem")) : null));
}

function reportUrl(m) {
  if (!safeUrl(REPORT_FORM)) return null;
  const q = new URLSearchParams({ usp: "pp_url" });
  q.set(REPORT_FIELDS.id, m.full_id || m.id || "");
  q.set(REPORT_FIELDS.name, m.name || "");
  return `${REPORT_FORM}?${q}`;
}

function actions(m, { withRoll } = {}) {
  return h("div", { class: "ticket-actions" },
    withRoll ? h("button", { type: "button", class: "btn primary", onclick: roll }, svg(ICON.mail, 22), "Open another") : null,
    shareButtons(m), saveButton(m));
}
// two ways to share: a plain link, or a sealed "gift" link with names and a hidden note
// sharing always starts at the card, so people see the note option; "Share without a note" is at the bottom of it
function shareButtons(m) {
  return [h("button", { type: "button", class: "btn", onclick: () => openGiftForm(m, { fresh: true }) }, svg(ICON.share, 20), "Share this mission")];
}
// link box + Copy / Share… / Preview, used for both kinds of link
function linkPanel(url) {
  const box = h("input", { class: "gift-link", readonly: true, "aria-label": "Your link", value: url, onfocus: (e) => e.target.select() });
  const copy = h("button", { type: "button", class: "btn primary" }, svg(ICON.link, 20), "Copy link");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); copy.lastChild.textContent = "Copied!"; }
    catch (e) { box.focus(); box.select(); copy.lastChild.textContent = "Press copy on your keyboard"; }
  });
  const share = navigator.share ? h("button", { type: "button", class: "btn" }, svg(ICON.share, 20), "Share…") : null;
  if (share) share.addEventListener("click", async () => {
    try { await navigator.share({ title: "An AmbleBee mission", text: "You've got mail from AmbleBee. Open the envelope:", url }); } catch (e) { /* closed the sheet */ }
  });
  return { box, copy, row: h("div", { class: "gift-actions" }, copy, share,
    h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" }, "Preview")) };
}
// no names, no note: still a sealed envelope (from "a friend") with the mission inside, and the link stays unreadable
async function sharePlain(m) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const url = giftUrl(await packGift(cleanGift({ m: m.full_id })));
  const p = linkPanel(url);
  body.replaceChildren(h("div", { class: "gift-done" },
    h("p", { class: "hand gift-kicker" }, "Just the mission"),
    h("h2", { id: "gift-title" }, "Here's your link"),
    h("p", { class: "gift-lede" }, "No names and no note. They'll get a sealed envelope from \u201ca friend\u201d with this mission inside."),
    p.box, p.row,
    h("div", { class: "gift-actions small" },
      h("button", { type: "button", class: "linkish", onclick: () => openGiftForm(m) }, "Add a card after all"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Done"))));
  p.copy.focus();
}

// ---- gift links ----------------------------------------------------------------------------------
// A gift link carries the mission, both names and the note in the part after "#", packed and encoded:
//   amblebee.com/#gift=1hY5BDoIwEEX3nKLp...
// Browsers never send the "#" part to a server, so GitHub and link-preview bots never see it, and the
// names and note aren't readable in the link. It is hidden, not encrypted: anyone who knows how could
// decode it. The note is only ever shown as plain text (never as HTML), because anyone can craft a link.
const b64url = {
  enc(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec(str) { let s = str.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
};
async function squash(bytes, Stream) {
  const out = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}
// format: one version character, then base64url. "1" = deflate-raw compressed JSON, "0" = plain JSON bytes.
async function packGift(g) {
  const raw = new TextEncoder().encode(JSON.stringify(g));
  let best = "0" + b64url.enc(raw);
  if (typeof CompressionStream === "function") {
    try { const z = "1" + b64url.enc(await squash(raw, CompressionStream)); if (z.length <= best.length) best = z; } catch (e) { /* plain is fine */ }
  }
  return best;
}
async function unpackGift(code) {
  try {
    const body = b64url.dec(code.slice(1));
    let bytes;
    if (code[0] === "1") {
      if (typeof DecompressionStream !== "function") return null;
      bytes = await squash(body, DecompressionStream);
    } else if (code[0] === "0") bytes = body;
    else return null;
    return cleanGift(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) { return null; }
}
// trim to limits (counting emoji as one character) and drop control characters, whatever the link says
function clip(v, max, keepLines) {
  if (typeof v !== "string") return "";
  const bad = keepLines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return Array.from(v.replace(/\r\n?/g, "\n").replace(bad, "").trim()).slice(0, max).join("").trim();
}
function cleanGift(g) {
  if (!g || typeof g !== "object") return null;
  const th = themeOf(g.th);
  const out = { m: clip(g.m, 160), f: clip(g.f, NAME_MAX), t: clip(g.t, NAME_MAX),
    n: clip(g.n, NOTE_MAX, true).replace(/\n{3,}/g, "\n\n"), th, s: SIGNOFF[g.s] ? g.s : THEMES[th].signs[0] };
  return out.m ? out : null;
}
const giftCode = () => { const g = /(?:^#|&)gift=([A-Za-z0-9_-]+)/.exec(location.hash); return g ? g[1] : null; };
const giftUrl = (code) => `${location.origin}${location.pathname}#gift=${code}`;
function cardArt(theme) {
  const el = h("span", { class: "gift-bee", "aria-hidden": "true" });
  const icon = THEMES[theme].icon;
  el.innerHTML = CARD_ART[icon] || `<svg viewBox="0 0 28 26" width="34" height="32">${BEE}</svg>`;
  return el;
}

// the little florist-style card the note is written on (shown only after the envelope is opened)
function giftNote(g) {
  return h("aside", { class: `gift-note theme-${themeOf(g.th)}`, "aria-label": `A note from ${g.f || "a friend"}` },
    h("span", { class: "gift-twine", "aria-hidden": "true" }),
    h("div", { class: "gift-card-inner" },
      cardArt(themeOf(g.th)),
      g.t ? h("p", { class: "gift-to" }, `${g.t},`) : null,
      g.n ? h("p", { class: "gift-body" }, g.n) : null,
      g.s !== "none" ? h("p", { class: "gift-sign" }, SIGNOFF[g.s] || "xo,") : null,
      h("p", { class: "gift-from" }, g.f || "a friend")));
}

// the card being written lasts as long as the tab, through a closed pop-up or a refresh
function keepDraft(g) {
  S.giftDraft = g;
  try { sessionStorage.setItem("amble.giftDraft", JSON.stringify(g)); } catch (e) { /* private mode: memory is enough */ }
}
function readDraft(id) {
  let g = S.giftDraft;
  if (!g) { try { g = JSON.parse(sessionStorage.getItem("amble.giftDraft")); } catch (e) { g = null; } }
  return g && g.m === id ? g : null;
}

// "Send with a note": you write right on the card, pick who it's for, then seal it
function openGiftForm(m, opts = {}) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const pack = S.packById[m.pack] || { name: m.pack };
  // "Write back": the names swap, the theme carries over, and the reply is about the same mission
  if (opts.fresh) S.replyTo = null;
  if (opts.reply) S.replyTo = opts.reply;
  const reply = S.replyTo && S.replyTo.m === m.full_id ? S.replyTo : null;
  let draft = readDraft(m.full_id);
  if (reply && (!draft || draft.t !== reply.f)) draft = { m: m.full_id, t: reply.f, f: reply.t, n: "", th: reply.th, s: null };
  let theme = themeOf(draft ? draft.th : readPref("giftTheme"));
  const lastSign = {};   // remembers the sign-off picked for each theme while you flip between them
  if (draft && draft.s) lastSign[theme] = draft.s;

  // the editable card: every field is written in place, in the card's handwriting
  const ruler = document.createElement("canvas").getContext("2d");
  const fit = (el, ph) => {   // size a name field to its text, so the comma sits right after the name
    const cs = getComputedStyle(el);
    ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    el.style.width = `${Math.ceil(ruler.measureText(el.value || ph).width) + 5}px`;
  };
  const to = h("input", { class: "gc-to", maxlength: NAME_MAX, autocomplete: "off", placeholder: "Their name", "aria-label": "To (their name)" });
  const from = h("input", { class: "gc-from", maxlength: NAME_MAX, autocomplete: "given-name", placeholder: "Your name", "aria-label": "From (your name)" });
  const note = h("textarea", { class: "gc-note", maxlength: NOTE_MAX, rows: 3, placeholder: "Write a little note… (optional, it stays hidden until they open the envelope)", "aria-label": "A little note" });
  const sign = h("select", { class: "gc-sign", "aria-label": "Sign-off" });
  to.value = draft ? draft.t : "";
  from.value = (draft && draft.f) || readPref("giftFrom") || "";
  note.value = draft ? draft.n : "";
  const grow = () => { note.style.height = "auto"; note.style.height = `${Math.max(90, note.scrollHeight)}px`; };
  [to, from].forEach((el) => el.addEventListener("input", () => fit(el, el.placeholder)));

  const art = h("span", { class: "gc-art" });
  const card = h("div", { class: "gift-note editing" },
    h("span", { class: "gift-twine", "aria-hidden": "true" }),
    h("div", { class: "gift-card-inner" }, art,
      h("p", { class: "gift-to" }, to, h("span", { "aria-hidden": "true" }, ",")),
      note,
      h("p", { class: "gift-sign" }, sign),
      h("p", { class: "gift-from" }, from)));

  const fillSigns = () => {
    const keep = signFor(theme, lastSign[theme] || (theme === themeOf(readPref("giftTheme")) ? readPref("giftSign") : null));
    sign.replaceChildren(...THEMES[theme].signs.map((k) => h("option", { value: k }, SIGNOFF[k])));
    sign.value = keep;
    sign.closest(".gift-sign").classList.toggle("is-none", keep === "none");
  };
  sign.addEventListener("change", () => { lastSign[theme] = sign.value; sign.closest(".gift-sign").classList.toggle("is-none", sign.value === "none"); });
  const setTheme = (k) => {
    theme = k;
    card.className = `gift-note editing theme-${k}`;
    art.replaceChildren(cardArt(k));
    fillSigns();
  };

  const chips = h("div", { class: "chips gift-themes", role: "radiogroup", "aria-label": "Who's it for?" },
    Object.entries(THEMES).map(([k, t]) => h("label", {},
      h("input", { type: "radio", name: "gift-theme", value: k, checked: k === theme, onchange: () => setTheme(k) }),
      h("span", {}, t.label))));

  const count = h("span", { class: "gift-count" });
  const updateCount = () => { const n = Array.from(note.value).length; count.textContent = n ? `${n} / ${NOTE_MAX}` : ""; count.classList.toggle("near", n > NOTE_MAX - 40); };
  note.addEventListener("input", () => { updateCount(); grow(); });
  const err = h("p", { class: "gift-err", role: "alert" });

  const form = h("form", { class: "gift-form", novalidate: true },
    h("p", { class: "hand gift-kicker" }, reply ? "Send one back" : "Send it sealed"),
    h("h2", { id: "gift-title" }, reply ? `Write back to ${reply.f}` : "Write them a card"),
    draft && draft.n ? h("p", { class: "gift-kept" }, "We kept what you wrote.") : null,
    h("p", { class: "gift-mission" }, svg(packIcon(pack), 18), h("span", {}, h("b", {}, m.name), ` · ${pack.name}`)),
    h("p", { class: "gift-label" }, "Who's it for?"),
    chips,
    h("div", { class: "gift-desk" }, card, count),
    h("p", { class: "gift-privacy" }, "Your note travels inside the link. It's hidden, not encrypted, so anyone with the link could read it."),
    err,
    h("div", { class: "gift-actions" },
      h("button", { type: "submit", class: "btn primary" }, svg(ICON.mail, 20), "Seal it"),
      h("button", { type: "button", class: "btn", onclick: () => sharePlain(m) }, "Share without a note"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Cancel")));

  // saved as they type, so closing the card by accident never loses it
  const saveCard = () => keepDraft({ m: m.full_id, t: to.value, f: from.value, n: note.value, th: theme, s: sign.value });
  form.addEventListener("input", saveCard);
  form.addEventListener("change", saveCard);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = cleanGift({ m: m.full_id, f: from.value, t: to.value, n: note.value, th: theme, s: sign.value });
    if (!g.t || !g.f) {
      err.textContent = !g.t ? "Who's it for? Write their name at the top of the card." : "Sign your name at the bottom so they know who it's from.";
      (!g.t ? to : from).focus(); return;
    }
    err.textContent = "";
    writePref("giftFrom", g.f); writePref("giftTheme", g.th); writePref("giftSign", g.s);
    keepDraft(g);
    sealGift(m, g, giftUrl(await packGift(g)));
  });

  setTheme(theme);
  updateCount();
  body.replaceChildren(form);
  if (!d.open) d.showModal();
  grow();
  [to, from].forEach((el) => fit(el, el.placeholder));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => [to, from].forEach((el) => fit(el, el.placeholder)));
  (to.value ? (from.value ? note : from) : to).focus();
}

// the card slides into the envelope, the flap closes, it flips to the addressed front, then the link
function sealGift(m, g, url) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const env = envelope({ title: `Sealed for ${g.t}.`, sub: g.n ? "Your note is tucked inside." : null, to: g.t, from: g.f });
  // same envelope as the one they'll open: the mission ticket goes in first, then the note card on top
  env.classList.add("sealing", "flip", "flap", "card-out", "note-out", "card-hidden", "note-hidden", "unstamped", "still");
  env.querySelector(".env-card").replaceChildren(miniTicket(m));
  const noteCard = h("div", { class: "env-notecard", "aria-hidden": "true" }, giftNote(g));
  env.querySelector(".env-card").after(noteCard);

  const { box, copy, row } = linkPanel(url);
  const done = h("div", { class: "gift-done", hidden: true },
    h("p", { class: "gift-lede" }, g.n
      ? `Send ${g.t} this link however you like. Your names are on the envelope; the note and the mission stay inside until they open it.`
      : `Send ${g.t} this link however you like. Your names are on the envelope; the mission stays a surprise until they open it.`),
    box, row,
    h("div", { class: "gift-actions small" },
      h("button", { type: "button", class: "linkish", onclick: () => openGiftForm(m) }, "Edit the card"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Done")));
  const kicker = h("p", { class: "hand gift-kicker" }, "Sealing it up…");
  const stage = h("div", { class: "gift-seal" }, kicker, h("h2", { id: "gift-title", class: "sr" }, `Sealed for ${g.t}`), h("div", { class: "seal-stage" }, env), done);
  body.replaceChildren(stage);
  body.scrollTop = 0;

  const finish = () => {
    env.classList.remove("still", "card-out", "note-out", "card-hidden", "note-hidden", "unstamped", "flap", "flip");
    stage.classList.add("sealed-up");
    kicker.textContent = "Sealed and stamped";
    done.hidden = false;
    copy.focus();
  };
  if (REDUCED()) { finish(); return; }
  fitMini(env);
  noteCard.style.setProperty("--ns", String(Math.min(1, (env.clientWidth * 0.62) / 300)));
  env.getBoundingClientRect();
  env.classList.remove("still");
  // each piece fades in, holds for a beat so you can see it's the right one, then slides in
  const PAUSE = 220;
  const steps = [
    [60, () => env.classList.remove("card-hidden")],                  // the mission ticket fades in
    [280 + PAUSE, () => env.classList.remove("card-out")],            // …and slides into the envelope
    [600, () => env.classList.remove("note-hidden")],                 // the note card fades in
    [280 + PAUSE, () => env.classList.remove("note-out")],            // …and slides in on top
    [560, () => env.classList.remove("flap")],                        // the flap folds shut
    [420, () => { env.classList.remove("unstamped"); env.classList.add("stamped"); }],   // the wax seal is pressed
    [560, () => { env.classList.remove("flip"); stage.classList.add("sealed-up"); }],    // flips over to the addressed front
    [560, finish],
  ];
  let at = 0;
  for (const [wait, fn] of steps) { at += wait; setTimeout(fn, at); }
}

// ---- save a mission as an image (for the camera roll) ----------------------------------------------
// Drawn on a canvas right here in the browser: nothing is uploaded. Text is drawn as text, never parsed.
function saveButton(m, gift) {
  const b = h("button", { type: "button", class: "btn", onclick: () => saveMissionImage(m, gift, b) }, svg(ICON.download, 20), "Save as image");
  return b;
}
const IMG = { w: 1080, pad: 64, minH: 1350, maxH: 2400 };
const IMGC = {   // always the light palette, so saved images look the same everywhere
  oat: "#EFE7D8", paper: "#FFFDF8", linen: "#FAF5EC", line: "#E4D9C6", lineStrong: "#D9CDB6", sand: "#F1E5D2",
  sage: "#A3B18A", sageDeep: "#566B48", sageTint: "#E3EAD6", sageInk: "#3F5235", honey: "#D8A65A", honeyTint: "#F6E6C6", honeyDeep: "#946628",
  walnut: "#5A3E2B", walnutSoft: "#7A5A42", ink: "#4A3323",
};
const IMGT = {   // note-card colours per theme: frame, dashed border, names
  partner: { frame: "#F6DDD6", dash: "#E2A699", accent: "#A9544A" },
  friend: { frame: "#E3EAD6", dash: "#A3B18A", accent: "#566B48" },
  family: { frame: "#F6E6C6", dash: "#D8A65A", accent: "#946628" },
};
const IMGF = {
  display: (w, px) => `${w} ${px}px "Fraunces Variable", "Fraunces", Georgia, serif`,
  body: (w, px) => `${w} ${px}px "Nunito Variable", "Nunito", "Segoe UI", system-ui, sans-serif`,
  hand: (px) => `700 ${px}px "Caveat", "Segoe Print", "Bradley Hand", cursive`,
};
function svgImage(markup, { size = 24, stroke = IMGC.walnut, viewBox = "0 0 24 24", fill = "none" } = {}) {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src); });
}
function rrect(ctx, x, y, w, hh, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// split text into lines that fit `width`; the last allowed line gets an ellipsis if it runs over
function wrapLines(ctx, text, width, maxLines = 99) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= width || !line) line = test; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const keep = out.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > width) last = last.replace(/\s*\S+$/, "");
    keep[maxLines - 1] = (last || "") + "…";
    return keep;
  }
  return out;
}
async function drawMission(m, gift) {
  const pack = S.packById[m.pack] || { name: m.pack };
  const c = coordsOf(m);
  const warn = cautionText(m);
  const [packImg, pinImg, clockImg, beeImg, tagImg, cautionImg] = await Promise.all([
    svgImage(packIcon(pack), { size: 64, stroke: "#FFFDF8" }),
    svgImage(ICON.pin, { size: 40, stroke: IMGC.sageDeep }),
    svgImage(ICON.clock, { size: 36, stroke: IMGC.walnutSoft }),
    svgImage(BEE, { size: 84, viewBox: "0 0 28 26", stroke: "none", fill: "none" }),
    svgImage(ICON.tag, { size: 36, stroke: IMGC.walnutSoft }),
    warn ? svgImage(ICON.caution, { size: 38, stroke: IMGC.honeyDeep }) : null,
  ]);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const W = IMG.w, P = IMG.pad, cardX = P, cardW = W - P * 2, inX = cardX + 52, inW = cardW - 104;

  // one pass to measure, one pass to draw
  const paint = (draw) => {
    let y = P;
    // header: hive + name
    if (draw && beeImg) ctx.drawImage(beeImg, P - 4, y - 6, 84, 78);
    if (draw) { ctx.font = IMGF.display(600, 44); ctx.fillStyle = IMGC.ink; ctx.textBaseline = "middle"; ctx.fillText("AmbleBee", P + 92, y + 36);
      const wA = ctx.measureText("AmbleBee ").width; ctx.fillStyle = IMGC.sageDeep; ctx.fillText("Missions", P + 92 + wA, y + 36); }
    y += 72 + 34;

    // optional note from a gift, as a little card
    if (gift && gift.n) {
      ctx.font = IMGF.hand(44);
      const noteLines = wrapLines(ctx, gift.n, cardW - 120, 6);
      const signLine = gift.s !== "none" ? (SIGNOFF[gift.s] || "") : "";
      const nh = 40 + (gift.t ? 52 : 0) + noteLines.length * 52 + (signLine ? 52 : 0) + 52 + 14;
      const tc = IMGT[themeOf(gift.th)];
      if (draw) {
        ctx.save(); ctx.translate(W / 2, y + nh / 2); ctx.rotate(-1.2 * Math.PI / 180); ctx.translate(-W / 2, -(y + nh / 2));
        ctx.shadowColor = "rgba(90,62,43,.18)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
        rrect(ctx, cardX + 20, y, cardW - 40, nh, 14); ctx.fillStyle = tc.frame; ctx.fill();
        ctx.shadowColor = "transparent";
        rrect(ctx, cardX + 30, y + 10, cardW - 60, nh - 20, 8); ctx.fillStyle = IMGC.paper; ctx.fill();
        ctx.setLineDash([8, 7]); ctx.strokeStyle = tc.dash; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        let ny = y + 40;
        ctx.textBaseline = "alphabetic"; ctx.font = IMGF.hand(44);
        if (gift.t) { ctx.fillStyle = tc.accent; ctx.fillText(`${gift.t},`, cardX + 60, ny + 38); ny += 52; }
        ctx.fillStyle = IMGC.ink;
        for (const l of noteLines) { ctx.fillText(l, cardX + 60, ny + 38); ny += 52; }
        ctx.textAlign = "right";
        if (signLine) { ctx.fillStyle = IMGC.walnutSoft; ctx.fillText(signLine, cardX + cardW - 90, ny + 38); ny += 52; }
        ctx.fillStyle = tc.accent; ctx.fillText(gift.f || "a friend", cardX + cardW - 70, ny + 38);
        ctx.textAlign = "left";
        ctx.restore();
      }
      y += nh + 36;
    }

    // the ticket
    const cardTop = y;
    const stubH = 128;
    y += stubH;
    y += 48;
    ctx.font = IMGF.display(600, 68);
    const titleLines = wrapLines(ctx, m.name, inW, 3);
    if (draw) { ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic"; titleLines.forEach((l, i) => ctx.fillText(l, inX, y + 58 + i * 78)); }
    y += titleLines.length * 78 + 18;
    ctx.font = IMGF.body(800, 36);
    const shortLines = wrapLines(ctx, m.short, inW, 4);
    if (draw) { ctx.fillStyle = IMGC.walnut; shortLines.forEach((l, i) => ctx.fillText(l, inX, y + 36 + i * 50)); }
    y += shortLines.length * 50 + 30;

    // tags
    const tags = [L.mode[m.mode] || m.mode, L.duration[m.duration] || m.duration, L.effort[m.effort] || m.effort,
      L.cost[m.cost] || m.cost, L.setting[m.setting] || m.setting,
      m.season && m.season !== "any" ? cap(list(m.season)) : null].filter(Boolean);
    ctx.font = IMGF.body(800, 28);
    let tx = inX, ty = y;
    tags.forEach((t, i) => {
      const tw = ctx.measureText(t).width + 40;
      if (tx + tw > inX + inW) { tx = inX; ty += 60; }
      if (draw) { rrect(ctx, tx, ty, tw, 48, 24); ctx.fillStyle = i === 0 ? IMGC.sageTint : IMGC.sand; ctx.fill();
        ctx.fillStyle = i === 0 ? IMGC.sageInk : IMGC.walnut; ctx.textBaseline = "middle"; ctx.fillText(t, tx + 20, ty + 25); }
      tx += tw + 12;
    });
    y = ty + 48 + 34;

    // where: place, address, coordinates
    if (m.place) {
      const pl = m.place;
      const boxTop = y;
      let by = y + 34;
      ctx.font = IMGF.body(900, 34);
      const nameLines = wrapLines(ctx, [pl.name, pl.area].filter(Boolean).join(", "), inW - 110, 3);
      if (draw) { ctx.textBaseline = "alphabetic"; ctx.fillStyle = IMGC.ink; nameLines.forEach((l, i) => ctx.fillText(l, inX + 86, by + 30 + i * 44)); }
      by += nameLines.length * 44 + 6;
      if (pl.address) {
        ctx.font = IMGF.body(700, 30);
        const addr = wrapLines(ctx, pl.address, inW - 110, 3);
        if (draw) { ctx.fillStyle = IMGC.walnut; addr.forEach((l, i) => ctx.fillText(l, inX + 86, by + 28 + i * 40)); }
        by += addr.length * 40 + 6;
      }
      if (c) {
        ctx.font = IMGF.body(800, 30);
        if (draw) { ctx.fillStyle = IMGC.sageDeep; ctx.fillText(`${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, inX + 86, by + 30); }
        by += 46;
      }
      by += 22;
      if (draw) {
        rrect(ctx, inX - 6, boxTop, inW + 12, by - boxTop, 24); ctx.fillStyle = IMGC.linen; ctx.fill();
        if (pinImg) ctx.drawImage(pinImg, inX + 24, boxTop + 30, 40, 40);
        // redraw text above the box fill
        let ry = boxTop + 34;
        ctx.font = IMGF.body(900, 34); ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic";
        nameLines.forEach((l, i) => ctx.fillText(l, inX + 86, ry + 30 + i * 44)); ry += nameLines.length * 44 + 6;
        if (pl.address) { ctx.font = IMGF.body(700, 30); ctx.fillStyle = IMGC.walnut;
          const addr = wrapLines(ctx, pl.address, inW - 110, 3); addr.forEach((l, i) => ctx.fillText(l, inX + 86, ry + 28 + i * 40)); ry += addr.length * 40 + 6; }
        if (c) { ctx.font = IMGF.body(800, 30); ctx.fillStyle = IMGC.sageDeep; ctx.fillText(`${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, inX + 86, ry + 30); }
      }
      y = by + 28;
    }

    // check before you go
    if (m.check_ahead && m.check_ahead.length) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, `Check before you go: ${checkText(m)}`, inW - 56, 3);
      if (draw) { if (clockImg) ctx.drawImage(clockImg, inX, y + 2, 36, 36); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 54, y + 30 + i * 42)); }
      y += lines.length * 42 + 24;
    }
    if (m.discounts && m.discounts.length) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, `Ask about discounts: ${discountText(m)}`, inW - 56, 3);
      if (draw) { if (tagImg) ctx.drawImage(tagImg, inX, y + 2, 36, 36); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 54, y + 30 + i * 42)); }
      y += lines.length * 42 + 24;
    }
    // caution: a honey box with a warning sign
    if (warn) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, warn, inW - 96, 6);
      const boxH = lines.length * 42 + 40;
      if (draw) {
        rrect(ctx, inX - 6, y, inW + 12, boxH, 22); ctx.fillStyle = IMGC.honeyTint; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = IMGC.honey; ctx.stroke();
        if (cautionImg) ctx.drawImage(cautionImg, inX + 16, y + 20, 38, 38);
        ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 70, y + 50 + i * 42));
      }
      y += boxH + 24;
    }

    // footer inside the ticket
    y += 12;
    if (draw) {
      ctx.setLineDash([6, 8]); ctx.strokeStyle = IMGC.lineStrong; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(inX, y); ctx.lineTo(inX + inW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = IMGF.body(700, 28); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
      ctx.fillText(`Mission ${m.number || "?"} in ${pack.name}`, inX, y + 50);
    }
    y += 80;
    const cardBottom = y;

    if (draw) {   // card + stub, painted under everything above by drawing them first (see below)
      paint.card = { top: cardTop, bottom: cardBottom, stubH };
    }
    y += 34;
    if (draw) { ctx.font = IMGF.body(800, 30); ctx.fillStyle = IMGC.sageDeep; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText("amblebee.com", W / 2, y + 20); ctx.textAlign = "left"; }
    y += 20 + P;
    return { y, cardTop, cardBottom, stubH };
  };

  const size = paint(false);
  const H = Math.max(IMG.minH, Math.min(IMG.maxH, Math.ceil(size.y)));
  const dpr = 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  // background
  ctx.fillStyle = IMGC.oat; ctx.fillRect(0, 0, W, H);
  // the ticket card and its stub go down first, so the content paints on top
  const extra = Math.max(0, (H - size.y) / 2);   // center short missions vertically
  ctx.save(); ctx.translate(0, extra);
  ctx.save(); ctx.shadowColor = "rgba(90,62,43,.16)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  rrect(ctx, cardX, size.cardTop, cardW, size.cardBottom - size.cardTop, 36); ctx.fillStyle = IMGC.paper; ctx.fill(); ctx.restore();
  ctx.save(); rrect(ctx, cardX, size.cardTop, cardW, size.cardBottom - size.cardTop, 36); ctx.clip();
  ctx.fillStyle = IMGC.sageDeep; ctx.fillRect(cardX, size.cardTop, cardW, size.stubH); ctx.restore();
  ctx.setLineDash([10, 9]); ctx.strokeStyle = IMGC.lineStrong; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cardX, size.cardTop + size.stubH + 2); ctx.lineTo(cardX + cardW, size.cardTop + size.stubH + 2); ctx.stroke(); ctx.setLineDash([]);
  if (packImg) ctx.drawImage(packImg, inX - 6, size.cardTop + 32, 64, 64);
  ctx.fillStyle = "#FFFDF8"; ctx.textBaseline = "middle";
  ctx.font = IMGF.body(800, 28); ctx.fillText("MISSION", inX + 76, size.cardTop + size.stubH / 2);
  const mw = ctx.measureText("MISSION ").width;
  ctx.font = IMGF.display(600, 60); ctx.fillText(String(m.number || "?"), inX + 76 + mw + 6, size.cardTop + size.stubH / 2 + 2);
  ctx.font = IMGF.body(800, 28); ctx.textAlign = "right"; ctx.fillText(pack.name || "", inX + inW, size.cardTop + size.stubH / 2); ctx.textAlign = "left";
  paint(true);
  ctx.restore();
  return canvas;
}
async function saveMissionImage(m, gift, btn) {
  const label = btn.lastChild, before = label.textContent;
  label.textContent = "Drawing…";
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([document.fonts.load(IMGF.display(600, 68)), document.fonts.load(IMGF.body(800, 36)), document.fonts.load(IMGF.hand(44))]).catch(() => {});
    }
    const canvas = await drawMission(m, gift && gift.n ? gift : null);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const name = `amblebee-${String(m.id || m.full_id || "mission").replace(/[^a-z0-9-]+/gi, "-")}.png`;
    const file = new File([blob], name, { type: "image/png" });
    // iPhone/iPad: the share sheet has "Save Image", which puts it in Photos.
    // Android and computers: a normal download (on Android, Google Photos shows it under Library > Download).
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: m.name }); label.textContent = before; return; }
      catch (e) { if (e && e.name === "AbortError") { label.textContent = before; return; } }
    }
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    label.textContent = "Saved to Downloads";
    setTimeout(() => { label.textContent = before; }, 2200);
  } catch (e) {
    label.textContent = "Couldn't save, try again";
    setTimeout(() => { label.textContent = before; }, 2600);
  }
}

// ---- home teaser + the reveal view ---------------------------------------------------------------
const revealing = () => document.body.classList.contains("revealing");
// ---- the sealed letter: flips over, the flap lifts, the mission card slides out ------------------
const REDUCED = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const LOST = {
  gone: "That mission isn't available right now. Open one of your own?",
  cut: "The link may have been cut off when it was copied. Ask them to send it again, or open your own.",
};
const BEE = '<path d="M6 21 h14" stroke="#7A5A42" stroke-width="2" stroke-linecap="round"/><path d="M8 21 C8 15 9 11 13 7 C17 11 18 15 18 21z" fill="#D8A65A"/><path d="M9.5 17 h7 M9 19 h8 M10.5 14.5 h5" stroke="#B5853F" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 21 v-2 a1.5 1.5 0 0 1 3 0 v2z" fill="#5A3E2B"/><ellipse cx="20" cy="6" rx="2.6" ry="1.8" fill="#FFFDF8" stroke="#7A5A42" stroke-width=".9" transform="rotate(-25 20 6)"/><ellipse cx="21.3" cy="9" rx="3.4" ry="2.5" fill="#E8B54A"/><path d="M20.6 6.8 v4.4 M22.4 7 v4" stroke="#5A3E2B" stroke-width="1"/><circle cx="24.4" cy="8.7" r="1.5" fill="#5A3E2B"/>';
function envelope({ title, sub, from, to, button, onOpen, card }) {
  const stamp = h("span", { class: "env-stamp", "aria-hidden": "true" });
  stamp.innerHTML = `<svg viewBox="0 0 28 26" width="46" height="43">${BEE}</svg><b>AmbleBee</b>`;
  const mark = h("span", { class: "env-postmark", "aria-hidden": "true" }, h("span", {}, "Hive"), h("span", {}, "Post"));
  const front = h("div", { class: "env-face env-front" }, stamp, mark,
    h("p", { class: "env-addr" }, h("span", {}, `To: ${to || "you"}`), h("span", {}, `From: ${from || "AmbleBee"}`)),
    h("p", { class: "hand env-title" }, title),
    sub ? h("p", { class: "env-sub" }, sub) : null,
    button ? h("button", { type: "button", class: "btn primary env-open", onclick: (e) => { e.stopPropagation(); onOpen(); } }, button) : null);
  const inner = h("div", { class: "env-card" }, card ? miniTicket(card) : null);
  const back = h("div", { class: "env-face env-back", "aria-hidden": "true" },
    inner, h("div", { class: "env-pocket" }), h("div", { class: "env-flap" }, h("span", { class: "env-seal" })));
  return h("div", { class: "env" }, h("div", { class: "env-body" }, front, back));
}
// The real ticket, laid out at its final width and shrunk to fit inside the envelope,
// so the card that slides out is the same ticket that then grows to full size.
const ticketWidth = () => Math.min(860, document.documentElement.clientWidth - (window.innerWidth <= 560 ? 32 : 40));
function miniTicket(m) {
  const w = h("div", { class: "env-ticket" }, ticket(m));
  w.style.width = `${ticketWidth()}px`;
  w.inert = true;
  return w;
}
function fitMini(env) {
  const card = env.querySelector(".env-card"), mini = card && card.firstChild;
  if (mini) mini.style.transform = `scale(${card.clientWidth / ticketWidth()})`;
}
// play the open animation, then call done(). A tap during the animation skips to the end.
function playOpen(env, done) {
  if (env.dataset.playing) return;
  env.dataset.playing = "1";
  let finished = false;
  const timers = [];
  const finish = () => { if (finished) return; finished = true; timers.forEach(clearTimeout); env.removeEventListener("click", finish); done(); };
  if (REDUCED()) { env.classList.add("fade"); timers.push(setTimeout(finish, 180)); return; }
  env.addEventListener("click", finish);
  env.classList.add("flip");
  timers.push(setTimeout(() => env.classList.add("flap"), 520));
  timers.push(setTimeout(() => env.classList.add("card-out"), 860));
  timers.push(setTimeout(finish, 1500));
}
function pickMission() {
  const p = pool();
  if (!p.length) return null;
  const choices = p.length > 1 && S.current ? p.filter((m) => m.full_id !== S.current.full_id) : p;
  const pick = (from) => from[Math.floor(Math.random() * from.length)];
  if (!S.here) return pick(choices);
  // with a ZIP set, most picks are real places nearby; the rest are do-anywhere ideas
  const f = readFilters();
  const reach = f.within != null ? f.within * M_PER[S.unit] : NEARBY_M;
  const near = choices.filter((m) => { const d = distM(m); return d != null && d <= reach; });
  const rest = choices.filter((m) => !near.includes(m));
  return pick(near.length && (!rest.length || Math.random() < NEARBY_SHARE) ? near : rest);
}
function renderTeaser() {
  const n = pool().length;
  const f = readFilters();
  const to = f.mode === "date" ? "the two of you" : f.mode === "adventure" ? "whoever's coming" : "you";
  if (!n) {
    $("#ticket-slot").replaceChildren(envelope({ title: "Nothing matches, yet.", sub: "Try clearing a filter or two.", to }));
    return;
  }
  const env = envelope({ title: "Your next mission is sealed inside.", to,
    sub: `${n} ${n === 1 ? "mission fits" : "missions fit"} what you picked.`,
    button: "Open", onOpen: () => openFromHome() });
  $("#ticket-slot").replaceChildren(env);
}
function openFromHome() {
  const env = $("#ticket-slot .env");
  const m = pickMission();
  if (!env || !m) return;
  const card = env.querySelector(".env-card");
  card.replaceChildren(miniTicket(m));
  fitMini(env);
  const r = env.getBoundingClientRect();
  const offscreen = r.top < 0 || r.bottom > window.innerHeight;
  if (offscreen && !REDUCED()) env.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => playOpen(env, () => goReveal(m, { growFrom: card.getBoundingClientRect() })), offscreen && !REDUCED() ? 380 : 0);
}
function goReveal(m, { replace = false, growFrom = null } = {}) {
  S.rolledId = m.full_id;
  const url = `#mission=${encodeURIComponent(m.full_id)}`;
  // "rolled" stays with this history entry, so a refresh still knows this mission is yours, not a shared one
  if (replace || revealing()) history.replaceState({ ...history.state, rolled: m.full_id }, "", url);
  else history.pushState({ amble: "reveal", rolled: m.full_id }, "", url);
  showReveal(m, { from: "roll", growFrom });
}
function rollSummary() {
  // e.g. "Picked for you from 46 missions in Amble Anywhere", "A date, picked from 31 missions within 30 mi of 97201"
  const f = readFilters();
  const p = pool().length;
  const lead = f.mode === "date" ? "A date, picked" : f.mode === "adventure" ? "An adventure, picked" : "Picked for you";
  let line = `${lead} from ${p} ${p === 1 ? "mission" : "missions"}`;
  if (f.pack !== "all") line += ` in ${(S.packById[f.pack] || {}).name || f.pack}`;
  if (S.here && f.within != null) line += ` within ${f.within} ${S.unit} of ${S.zip}`;
  else if (S.here) line += ` near ${S.zip}`;
  const n = activeFilters(f);
  if (n) line += ` with ${n} ${n === 1 ? "filter" : "filters"}`;
  return line;
}
function showReveal(m, { from = "roll", sealed = false, animate = false, growFrom = null } = {}) {
  S.current = m; S.revealFrom = from;
  document.body.classList.add("revealing");
  $("#reveal").hidden = false;
  const gift = from === "gift" ? S.gift : null;
  const linked = from === "link" || !!gift;
  $("#reveal-kicker").textContent = gift ? `A mission from ${gift.f || "a friend"}` : linked ? "A mission, shared with you" : "Your mission";
  $("#reveal-summary").textContent = gift ? `Sealed just for ${gift.t || "you"}. Open your own any time.`
    : linked ? "Someone sent you this one. Open your own any time." : rollSummary();
  $("#reveal-summary").hidden = sealed || from === "mine";   // "mine": reopened, so the old picks are gone
  window.scrollTo({ top: 0 });
  const slot = $("#reveal-slot");
  if (sealed || animate) {
    $("#reveal-actions").replaceChildren(); $("#reveal-adjust").hidden = true;
    const env = envelope({
      title: gift ? `${gift.f || "Someone"} sent you a mission.` : sealed ? "Someone sent you a mission." : "Your next mission is sealed inside.",
      sub: gift && gift.n ? "There's a note tucked inside." : null,
      to: gift ? gift.t || "you" : "you", from: gift ? gift.f || "a friend" : sealed ? "a friend" : "AmbleBee", card: m,
      button: sealed ? "Open" : null, onOpen: () => open() });
    const open = () => playOpen(env, () => showReveal(m, { from, growFrom: env.querySelector(".env-card").getBoundingClientRect() }));
    env.classList.add("in-reveal");
    slot.replaceChildren(env);
    fitMini(env);
    if (animate) setTimeout(open, REDUCED() ? 0 : 260);
    return;
  }
  const t = ticket(m, { titleId: "reveal-title" });
  slot.replaceChildren(...(gift && gift.n ? [giftNote(gift), t] : [t]));
  const replyTo = gift && gift.f ? gift : null;
  $("#reveal-actions").replaceChildren(...[   // replaceChildren would print a null as the word "null", so drop it
    replyTo ? h("button", { type: "button", class: "btn primary", onclick: () => openGiftForm(m, { reply: replyTo }) }, svg(ICON.mail, 22), `Write back to ${replyTo.f}`) : null,
    h("button", { type: "button", class: replyTo ? "btn" : "btn primary", onclick: roll }, replyTo ? null : svg(ICON.mail, 22), linked ? "Open your own" : "Open another"),
    ...shareButtons(m),
    saveButton(m, gift),
    h("button", { type: "button", class: "btn", onclick: () => startOver() }, "Start over"),
  ].filter(Boolean));
  $("#reveal-adjust").hidden = linked;
  if (growFrom && growFrom.width && !REDUCED()) growTicket(t, growFrom); else t.classList.add("pop");
  const title = $("#reveal-title"); if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
}
// FLIP: start the full ticket at the envelope card's spot and size, then let it grow into place.
function growTicket(t, from) {
  const to = t.getBoundingClientRect();
  if (!to.width) { t.classList.add("pop"); return; }
  const s = from.width / to.width;
  const cut = Math.max(0, to.height - from.height / s);
  const rest = [$("#reveal-actions"), $("#reveal-adjust"), $(".reveal-head")];
  rest.forEach((e) => e && e.classList.add("grow-wait"));
  t.style.transformOrigin = "0 0";
  t.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`;
  t.style.clipPath = `inset(0 0 ${cut}px 0 round 24px)`;
  t.getBoundingClientRect();
  requestAnimationFrame(() => {
    t.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1), clip-path .6s cubic-bezier(.2,.8,.2,1)";
    t.style.transform = "";
    t.style.clipPath = "inset(0 0 0 0 round 24px)";
    setTimeout(() => {
      t.style.transition = ""; t.style.clipPath = ""; t.style.transformOrigin = "";
      rest.forEach((e) => e && e.classList.remove("grow-wait"));
    }, 640);
  });
}
function showHome() {
  document.body.classList.remove("revealing");
  $("#reveal").hidden = true;
  S.current = null;
  renderTeaser();
}
// a link that can't be delivered: says so in the reveal view, where it can't be missed on a phone
function showLost(sub) {
  S.current = null;
  document.body.classList.add("revealing");
  $("#reveal").hidden = false;
  $("#reveal-kicker").textContent = "Return to sender";
  $("#reveal-summary").hidden = true;
  $("#reveal-actions").replaceChildren(); $("#reveal-adjust").hidden = true;
  const env = envelope({ title: "This letter got lost in the mail.", sub, to: "you", button: "Open your own",
    onOpen: () => {
      history.replaceState(null, "", location.pathname + location.search);
      S.shownGift = null; S.shownLost = null; S.giftKey = null; S.giftP = Promise.resolve(null);
      showHome(); openFromHome();
    } });
  env.classList.add("in-reveal");
  $("#reveal-slot").replaceChildren(env);
  window.scrollTo({ top: 0 });
}
// Back from the reveal goes home. A reveal opened from the home page pushes one history entry;
// re-rolls replace it, so Back always lands on the home page.
function startOver({ filters = false, then = null } = {}) {
  S.afterHome = filters ? "filters" : then;   // then: {id, search} = scroll to a section once home is showing
  if (history.state && history.state.amble === "reveal") { history.back(); return; }
  history.replaceState(null, "", location.pathname + location.search);
  route();
}
async function route() {
  // gift links: decode (async), show the sealed envelope once per link, then the ticket + note
  const code = giftCode();
  if (code !== S.giftKey) { S.giftKey = code; S.giftP = code ? unpackGift(code) : Promise.resolve(null); }
  const gift = await S.giftP;
  if (code !== giftCode()) return;   // the link changed while we were decoding
  S.gift = gift;
  if (code) {
    const gm = gift && S.missions.find((x) => x.full_id === gift.m);
    if (gm) {
      if (S.shownGift !== code) { S.shownGift = code; showReveal(gm, { from: "gift", sealed: true }); }
    } else if (S.shownGift !== code) {
      S.shownGift = code;
      showLost(gift ? LOST.gone : LOST.cut);
    }
    S.booted = true; return;
  }
  S.shownGift = null;
  const m = fromHash();
  if (m) {
    if (!revealing() || m !== S.current) {
      // your own pick after a refresh, or arriving from the mission's own page: no envelope from "a friend"
      const mine = (history.state && history.state.rolled === m.full_id) || /(?:^#|&)from=page(?:&|$)/.test(location.hash);
      const from = S.rolledId === m.full_id ? "roll" : mine ? "mine" : "link";
      showReveal(m, { from, sealed: from === "link" && !S.booted });
    }
    S.booted = true; return;
  }
  const wanted = hashMission();
  if (wanted != null) {
    if (S.shownLost !== location.hash) { S.shownLost = location.hash; showLost(wanted ? LOST.gone : LOST.cut); }
    S.booted = true; return;
  }
  S.shownLost = null;
  S.booted = true;
  if (revealing() || !$("#ticket-slot").firstChild) showHome();
  const after = S.afterHome; S.afterHome = null;
  if (after === "filters") {
    $("#filters").hidden = true; $("#filters-toggle").click();
  } else if (after === "top") {
    window.scrollTo({ top: 0 });
  } else if (after && after.id) {
    const el = document.getElementById(after.id);
    requestAnimationFrame(() => {
      if (el) el.scrollIntoView({ behavior: REDUCED() ? "auto" : "smooth" });
      if (after.search) $("#search-input").focus({ preventScroll: true });
    });
  }
}
function roll() {
  if (!revealing()) { if (!pool().length) { startOver(); return; } openFromHome(); return; }
  const m = pickMission();
  if (!m) { startOver(); return; }
  S.rolledId = m.full_id;
  history.replaceState({ ...history.state, rolled: m.full_id }, "", `#mission=${encodeURIComponent(m.full_id)}`);
  showReveal(m, { from: "roll", animate: true });
}
function openDialog(m) {
  const body = $("#dialog-body");
  body.replaceChildren(ticket(m, { titleId: "dialog-title" }), actions(m));
  const d = $("#mission-dialog");
  if (typeof d.showModal === "function") d.showModal(); else { S.rolledId = null; history.pushState({ amble: "reveal" }, "", `#mission=${encodeURIComponent(m.full_id)}`); showReveal(m, { from: "link" }); }
}

// ---- browse --------------------------------------------------------------------------------------
// search: every word must match a whole word in the mission, so "sea" doesn't find "season".
// Longer words also match word starts ("waterfal"); matches in the name rank highest.
const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019]/g, "");
const tokens = (t) => fold(t).split(/[^a-z0-9]+/).filter(Boolean);
const stem = (w) => (w.length < 4 ? w : /(ch|sh|ss|x)es$/.test(w) ? w.slice(0, -2) : /[^s]s$/.test(w) ? w.slice(0, -1) : w);
const STOP_WORDS = new Set("a an and at by do for from fun in near of on or some the thing things to with".split(" "));
const SEARCH_ALSO = {   // one way: "food" finds dinner, but "dinner" doesn't find all food
  hike: ["hiking", "trail"], hiking: ["hike", "trail"], trail: ["hike", "hiking"],
  food: ["restaurant", "dinner", "lunch", "brunch"], eat: ["food", "restaurant", "dinner", "lunch", "brunch"],
  restaurant: ["dinner", "lunch", "brunch"], drink: ["bar", "beer", "wine", "cocktail", "brewery"],
  kid: ["children", "child"], child: ["kid"], children: ["kid"],
  beach: ["ocean", "coast", "shore"], ocean: ["sea", "beach", "coast"], sea: ["ocean"],
  bike: ["biking", "cycling"], biking: ["bike", "cycling"], swim: ["swimming"], camp: ["camping"],
  rain: ["rainy", "indoor"], rainy: ["indoor"], view: ["overlook", "lookout", "vista"],
  cheap: ["free"], romantic: ["date"], boat: ["boating", "kayak", "canoe", "ferry"],
};
function searchIndex(m) {
  if (m._words) return m;
  const pack = S.packById[m.pack] || {};
  const pl = m.place || {};
  const parts = [m.name, m.short, m.description, (m.tags || []).join(" "),
    (m.themes || []).map((t) => (S.themeLabel || {})[t] || t).join(" "), pl.name, pl.area, pl.address,
    pack.name, pack.region, m.credit, m.id, (m.gear || []).map((g) => g.item).join(" "),
    m.for_kids && m.for_kids.short, (m.season === "any" ? [] : m.season || []).join(" "),
    L.mode[m.mode], L.setting && L.setting[m.setting], L.time && L.time[m.time_of_day],
    (m.who || []).join(" "), m.cost === "free" ? "free" : "",
    (m.discounts || []).length ? "discount discounts deal " + m.discounts.map((d) => `${d} ${L.discount[d] || ""}`).join(" ")
      + (m.discounts.includes("military") ? " veteran veterans" : "") + (m.discounts.includes("educator") ? " teacher" : "")
      + (m.discounts.includes("senior") ? " senior citizen" : "") : ""];
  const stems = (t) => new Set(tokens(t).map(stem));
  m._nameWords = stems(m.name);
  m._tagWords = stems((m.tags || []).join(" "));
  m._words = stems(parts.filter(Boolean).join(" "));
  return m;
}
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
function wordScore(m, word, loose) {
  const { _words: all, _nameWords: name, _tagWords: tag } = searchIndex(m);
  const weight = (w) => (name.has(w) ? 5 : tag.has(w) ? 3 : 1);
  const w = stem(word);
  if (all.has(w)) return weight(w);
  const also = (SEARCH_ALSO[w] || SEARCH_ALSO[word] || []).map(stem).filter((a) => all.has(a));
  if (also.length) return Math.max(...also.map(weight)) - 0.5;
  if (word.length >= 4 || loose) for (const t of all) if (t.startsWith(w)) return name.has(t) ? 3 : 1;
  if (loose && w.length >= 5) {
    const most = w.length >= 8 ? 2 : 1;
    for (const t of all) if (t[0] === w[0] && Math.abs(t.length - w.length) <= most && editDistance(w, t) <= most) return 0.5;
  }
  return 0;
}
function searchScore(m, words, loose) {
  let score = 0;
  for (const w of words) {
    const s = wordScore(m, w, loose);
    if (!s) return 0;
    score += s;
  }
  return score;
}
function searchWords() {
  const all = tokens(S.q);
  const useful = all.filter((w) => !STOP_WORDS.has(w));
  return useful.length ? useful : all;
}
// theme chip counts follow the other picks (pack, mode, distance, More filters), so "Waterfalls 3" means
// 3 waterfall missions you could actually get right now. Chips with none left are dimmed, not removed.
function renderThemeCounts(f) {
  const labels = document.querySelectorAll('[data-filter="themes"] label');
  if (!labels.length) return;
  const base = S.missions.filter((m) => passes(m, { ...f, themes: [] }));
  const rows = [...labels].map((l) => {
    const id = l.querySelector("input").value;
    const n = base.filter((m) => (m.themes || []).includes(id)).length;
    l.querySelector(".count").textContent = String(n);
    l.querySelector("input").setAttribute("aria-label", `${S.themeLabel[id] || id}, ${n} ${n === 1 ? "mission" : "missions"}`);
    l.classList.toggle("is-empty", n === 0);
    return { l, n, name: S.themeLabel[id] || id };
  });
  // themes you can get right now first, A to Z, then the dimmed ones, A to Z. Picking a theme never changes
  // the counts (they ignore the theme picks), so chips only move when another filter changes.
  rows.sort((a, b) => (a.n === 0) - (b.n === 0) || a.name.localeCompare(b.name));
  labels[0].parentElement.append(...rows.map((r) => r.l));
}
// only published missions count as live; drafts are still being checked and never show on the site
function liveLine() {
  const drafts = (S.catalog.stats || {}).drafts || 0;
  return `${S.missions.length} live missions in ${S.packs.length} packs${drafts ? `, ${drafts} more being checked` : ""}`;
}
function renderBrowse() {
  const f = readFilters();
  renderThemeCounts(f);
  const matches = S.missions.filter((m) => passes(m, f));
  const n = matches.length, total = S.missions.length;
  const active = activeFilters(f);
  const mc = $("#match-count");
  const word = (k) => (k === 1 ? "mission" : "missions");
  mc.className = "match" + (n === total ? "" : " filtered") + (n === 0 ? " zero" : "");
  const narrowed = active > 0 || f.within != null;   // pack or "Who's it for?" alone aren't "filters"
  mc.textContent = !narrowed && n ? `${n} ${word(n)} to pick from`
    : !active && n && S.here ? `${n} ${word(n)} to pick from, within ${f.within} ${S.unit} of ${S.zip}`
    : n === 0 ? "No missions fit these filters. Try clearing one."
    : n === 1 ? "Only 1 mission fits these filters"
    : `Picking from ${n} ${word(n)} that fit these filters`;
  const fm = $("#filters-match");
  fm.replaceChildren(n === 0 ? "No missions fit. Try clearing one."
    : h("span", {}, h("b", {}, String(n)), ` ${word(n)} ${n === total ? "(everything)" : "with these filters"}`));
  const fc = $("#filters-count");
  fc.hidden = !active; fc.textContent = String(active);
  fc.setAttribute("aria-label", `${active} on`);
  // "Every mission" follows every pick except "Pick from", because the list has its own pack menu
  const everything = S.missions.filter((m) => passes(m, { ...f, pack: "all" }));
  const browsing = narrowed || f.mode !== "any";
  $("#browse-count").textContent = browsing ? `${everything.length} of ${total} live missions fit your filters` : liveLine();
  $("#browse-clear").hidden = !browsing;

  renderBrowsePick(everything);
  const wrap = $("#packs");
  wrap.replaceChildren();
  const words = searchWords();
  const searching = words.length > 0;
  $("#search-hint").hidden = !searching;
  $("#search-hint").textContent = browsing ? "Searching the missions that fit your filters." : "Searching all missions in every pack.";
  $(".pack-field").hidden = searching;
  const card = (m) => {
    const d = distM(m);
    const pack = S.packById[m.pack];
    // little circles on the top right: a kids' version, and discounts the place offers
    const flags = [];
    if ((m.who || []).includes("kids") && m.for_kids) {
      flags.push(h("span", { class: "flag kids", title: "Has a kids' version", role: "img", "aria-label": "Has a kids' version" },
        svg(siteIcon("kid", ICON.compass), 15)));
    }
    if (m.discounts && m.discounts.length) {
      flags.push(h("span", { class: "flag deal", title: "Ask about discounts", role: "img", "aria-label": "Ask about discounts" },
        svg(siteIcon("discount", ICON.tag), 15)));
    }
    return h("button", { type: "button", class: "card", onclick: () => openDialog(m) },
      h("span", { class: "card-top" },
        h("span", { class: "no" }, (S.browse === "near" || searching) && pack ? `${pack.name} · Mission ${m.number}`
          : `Mission ${m.number}${m.place && m.place.area ? " · " + m.place.area : ""}`),
        flags.length ? h("span", { class: "flags" }, flags) : null),
      h("h4", {}, m.name),
      h("p", { class: "s" }, m.short),
      h("span", { class: "meta" },
        d != null ? h("span", { class: "d" }, fmtDist(d)) : null,
        h("span", {}, L.mode[m.mode] || m.mode),
        h("span", {}, L.duration[m.duration] || m.duration),
        h("span", {}, L.cost[m.cost] || m.cost)));
  };
  if (searching) {
    const rank = (loose) => everything.map((m) => [searchScore(m, words, loose), m]).filter(([sc]) => sc > 0)
      .sort((a, b) => b[0] - a[0] || (S.here ? (distM(a[1]) ?? 1e12) - (distM(b[1]) ?? 1e12) : 0)
        || a[1].name.localeCompare(b[1].name))
      .map(([, m]) => m);
    let found = rank(false);
    const close = !found.length;
    if (close) found = rank(true);   // nothing exact: try short word starts and small typos
    $("#browse-count").textContent = close && found.length
      ? `${found.length} close ${found.length === 1 ? "match" : "matches"} for "${S.q.trim()}"`
      : `${found.length} ${found.length === 1 ? "mission matches" : "missions match"} "${S.q.trim()}"`;
    if (found.length) wrap.append(h("section", { class: "pack", "aria-label": "Search results" },
      h("div", { class: "cards" }, found.map(card))));
    else wrap.append(h("p", { class: "none" },
      browsing ? `Nothing matches "${S.q.trim()}" with these filters. Try clearing them.`
        : `Nothing matches "${S.q.trim()}". Try a different word, like a town, a place or an activity.`));
    return;
  }
  if (S.browse === "near" && S.here) {
    const near = everything.filter((m) => distM(m) != null).sort((x, y) => distM(x) - distM(y)).slice(0, NEAR_MAX);
    if (near.length) wrap.append(h("section", { class: "pack", "aria-label": "Closest to your ZIP" },
      h("div", { class: "pack-head" },
        h("span", { class: "badge" }, svg(ICON.pin, 26)),
        h("div", {}, h("h3", {}, `Closest to ${S.zip}`),
          h("p", {}, `The ${near.length} nearest places, as the bee flies. Amble Anywhere missions work from any ZIP.`))),
      h("div", { class: "cards" }, near.map(card))));
  } else {
    for (const p of S.packs) {
      if (S.browse !== "all" && S.browse !== p.id) continue;
      const ms = everything.filter((m) => m.pack === p.id);
      if (!ms.length) continue;
      if (S.here) ms.sort((x, y) => (distM(x) ?? 0) - (distM(y) ?? 0) || x.number - y.number);
      wrap.append(h("section", { class: "pack", "aria-label": p.name },
        h("div", { class: "pack-head" },
          h("span", { class: "badge" }, svg(packIcon(p), 26)),
          h("div", {}, h("h3", {}, p.name), p.description ? h("p", {}, p.description) : null)),
        h("div", { class: "cards" }, ms.map(card))));
    }
  }
  if (!wrap.children.length) wrap.append(h("p", { class: "none" }, browsing ? "None of these fit your filters. Clear them to see more." : "No missions in this pack yet."));
}
function renderBrowsePick(matches) {
  const sel = $("#browse-pack");
  const count = (id) => matches.filter((m) => id === "all" || m.pack === id).length;
  const opts = [];
  if (S.here) opts.push(h("option", { value: "near" }, `Closest to ${S.zip}`));
  opts.push(h("option", { value: "all" }, `Every pack (${count("all")})`));
  for (const p of S.packs) opts.push(h("option", { value: p.id }, `${p.name} (${count(p.id)})`));
  sel.replaceChildren(...opts);
  if (S.browse === "near" && !S.here) S.browse = null;
  if (!S.browse || ![...sel.options].some((o) => o.value === S.browse)) S.browse = "all";
  sel.value = S.browse;
}

// ---- pack list in "What is AmbleBee?": Anywhere first, then the 4 biggest packs, then "+ N more"
const LEGEND_TOP = 4;
function renderLegend() {
  const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const goTo = (id) => { S.browse = id; renderBrowse(); $("#browse").scrollIntoView({ behavior: "smooth" }); };
  const item = (p) => h("li", {}, h("button", { type: "button", onclick: () => goTo(p.id) },
    svg(packIcon(p), 20), h("b", {}, p.name), h("span", {}, word(p.count, "mission", "missions"))));
  const pinned = S.packs.filter((p) => p.id === "anywhere");
  const rest = S.packs.filter((p) => p.id !== "anywhere")
    .sort((x, y) => y.count - x.count || (x.name || x.id).localeCompare(y.name || y.id));
  const shown = rest.slice(0, LEGEND_TOP), hidden = rest.slice(LEGEND_TOP);
  const items = [...pinned, ...shown].map(item);
  if (hidden.length) {
    const more = hidden.reduce((n, p) => n + p.count, 0);
    items.push(h("li", { class: "more" }, h("button", { type: "button", onclick: () => goTo("all") },
      h("b", {}, `+ ${word(hidden.length, "more pack", "more packs")}`),
      h("span", {}, `${word(more, "more mission", "more missions")}`))));
  }
  $("#pack-legend").replaceChildren(...items);
}

// ---- near me -------------------------------------------------------------------------------------
function renderWithin() {
  const sel = $("#within-select");
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "" }, "any distance"),
    ...WITHIN[S.unit].map((v) => h("option", { value: v }, `${v} ${S.unit}`)));
  sel.value = WITHIN[S.unit].includes(Number(keep)) ? keep : "";
  sel.disabled = !S.here;
  document.querySelectorAll(".units button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === S.unit)));
}
async function setZip(e) {
  e.preventDefault();
  const status = $("#zip-status");
  const zip = ($("#zip-input").value || "").trim();
  if (!/^\d{5}$/.test(zip)) { status.textContent = "A ZIP code is 5 numbers, like 97201."; return; }
  if (!S.zips) {
    status.textContent = "Looking it up…";
    try {
      const r = await fetch("zips.json");
      if (!r.ok) throw new Error(r.status);
      S.zips = (await r.json()).zips || {};
    } catch (err) {
      status.textContent = "ZIP lookup isn't available right now. You can still browse everything.";
      return;
    }
  }
  const c = S.zips[zip];
  if (!c) { status.textContent = `Couldn't find ${zip}. Double-check the number? (US ZIP codes only for now.)`; return; }
  const first = !S.here;
  S.here = { lat: c[0], lon: c[1] }; S.zip = zip;
  if (first && $("#pack-select").value === "anywhere") { $("#pack-select").value = "all"; S.packWidened = true; }
  renderWithin();
  if (first && !$("#within-select").value) $("#within-select").value = String(WITHIN[S.unit][2]);
  if (first && (S.browse === "anywhere" || S.browse === "all" || !S.browse)) S.browse = "near";
  status.replaceChildren(h("span", { class: "zip-set" }, `Near ${zip}`),
    ": places close by plus missions you can do anywhere. Distances are as the bee flies.",
    h("button", { type: "button", class: "linkish zip-clear", onclick: clearZip }, "Clear"));
  renderWithin(); refresh();
  rerenderReveal();
}
function clearZip() {
  S.here = null; S.zip = null; $("#zip-input").value = "";
  if (S.packWidened && $("#pack-select").value === "all") $("#pack-select").value = "anywhere";
  S.packWidened = false;
  if (S.browse === "near") S.browse = null;
  $("#within-select").value = "";
  $("#zip-status").textContent = "Add a ZIP to see places close by, plus missions you can do anywhere. It never leaves this browser tab.";
  renderWithin(); refresh();
  rerenderReveal();
}

// ---- wiring --------------------------------------------------------------------------------------
function refresh() {
  renderBrowse();
  if (!revealing()) renderTeaser();
}
const rerenderReveal = () => { if (revealing() && S.current) showReveal(S.current, { from: S.revealFrom }); };
// the mission named in the address: null = none, "" = there but unreadable (a link cut off partway)
function hashMission() {
  const m = /(?:^#|&)mission=([^&]*)/.exec(location.hash);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return ""; }
}
function fromHash() {
  const id = hashMission();
  return id ? S.missions.find((x) => x.full_id === id) : null;
}

async function start() {
  let data;
  // the icon pack loads alongside the catalog; if it fails, every pack just shows the compass
  const iconsP = fetch("icons.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    const r = await fetch("catalog.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch (e) {
    $("#ticket-slot").replaceChildren(h("div", { class: "empty" }, h("p", { class: "hand" }, "The missions didn't load."), "Try refreshing the page."));
    document.documentElement.classList.remove("arriving");
    return;
  }
  S.catalog = data;
  const iconSets = (await iconsP) || {};
  S.icons = iconSets.packs || {};
  S.siteIcons = iconSets.site || {};
  S.missions = data.missions || [];
  const order = (p) => (p.id === "anywhere" ? "0" : p.id === "general" ? "2" : "1") + (p.name || p.id);
  S.packs = (data.packs || []).filter((p) => p.count).sort((a, b) => order(a).localeCompare(order(b)));
  S.packById = Object.fromEntries(S.packs.map((p) => [p.id, p]));
  // theme chips (More filters): only themes some published mission has, each with its count. The whole
  // group stays hidden until missions have themes, so the site looks the same during the backfill.
  S.themeLabel = Object.fromEntries((data.themes || []).map((t) => [t.id, t.label]));
  const themeChips = (data.themes || [])
    .map((t) => [t, S.missions.filter((m) => (m.themes || []).includes(t.id)).length])
    .filter(([, n]) => n > 0)
    .map(([t, n]) => h("label", {}, h("input", { type: "checkbox", value: t.id }),
      h("span", {}, t.label, h("small", { class: "count" }, String(n)))));
  if (themeChips.length) {
    $('[data-filter="themes"]').replaceChildren(...themeChips);
    $("#themes-field").hidden = false;
  }

  const sel = $("#pack-select");
  S.packs.forEach((p) => sel.append(h("option", { value: p.id }, p.name)));
  if (S.packById.anywhere) sel.value = "anywhere";
  renderLegend();
  const src = data.source || {};
  $("#catalog-meta").textContent = `${src.name || "Missions"} · ${S.missions.length} live missions · updated ${src.updated || "recently"}`;

  const form = $("#form-link");
  if (safeUrl(FORM_URL)) { form.href = FORM_URL; form.target = "_blank"; form.rel = "noopener"; }
  else { form.href = REPO_URL; $("#form-note").textContent = "The submission form opens soon. Until then, a pull request on GitHub works, or check back."; }
  $("#repo-link").href = REPO_URL;

  document.querySelectorAll('input[name="mode"], #filters input[type="checkbox"], #pack-select, #within-select')
    .forEach((el) => el.addEventListener("change", () => refresh()));
  $("#pack-select").addEventListener("change", () => { S.packWidened = false; });
  $("#roll-btn").addEventListener("click", () => roll());
  $("#zip-form").addEventListener("submit", setZip);
  $("#browse-pack").addEventListener("change", (e) => { S.browse = e.target.value; renderBrowse(); });
  let searchTimer = null;
  const sInput = $("#search-input");
  sInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.q = sInput.value; renderBrowse(); }, 120);
  });
  sInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { sInput.value = ""; S.q = ""; renderBrowse(); } });
  $("#nav-search").addEventListener("click", (e) => {
    e.preventDefault();
    $("#browse").scrollIntoView({ behavior: "smooth" });
    setTimeout(() => sInput.focus({ preventScroll: true }), 300);
  });
  document.querySelectorAll(".units button").forEach((b) => b.addEventListener("click", () => {
    S.unit = b.dataset.unit; writePref("unit", S.unit); renderWithin(); refresh(); rerenderReveal();
  }));
  const toggle = $("#filters-toggle");
  const setPanel = (open) => {
    const panel = $("#filters"); panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    $("#filters-label").textContent = open ? "Hide filters" : "More filters";
  };
  toggle.addEventListener("click", () => {
    const opening = $("#filters").hidden;
    setPanel(opening);
    if (opening) $("#filters").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("#filters-done").addEventListener("click", () => {
    setPanel(false);
    $(".roll").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#browse-clear").addEventListener("click", () => {
    document.querySelectorAll("#filters input").forEach((i) => { i.checked = false; });
    document.querySelector('input[name="mode"][value="any"]').checked = true;
    $("#within-select").value = "";
    refresh();
  });
  $("#filters-reset").addEventListener("click", () => {
    document.querySelectorAll("#filters input").forEach((i) => { i.checked = false; });
    refresh();
  });
  // a tap on the dim area closes a pop-up, but only if the press began there (dragging out of a text box doesn't count)
  const closeOnBackdrop = (d, keepOpen) => {
    let began = false;
    d.addEventListener("pointerdown", (e) => { began = e.target === d; });
    d.addEventListener("click", (e) => { if (e.target === d && began && !(keepOpen && keepOpen())) d.close(); });
  };
  closeOnBackdrop($("#mission-dialog"));
  // a card with writing on it stays open; X, Cancel and Escape still close it, and the draft is kept
  closeOnBackdrop($("#gift-dialog"), () => [...document.querySelectorAll("#gift-body .gc-to, #gift-body .gc-note")].some((el) => el.value.trim()));
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
  $("#reveal-adjust").addEventListener("click", () => startOver({ filters: true }));
  // skip link: move focus without touching the address, which would close an open mission
  $(".skip").addEventListener("click", (e) => {
    e.preventDefault();
    const m = $("#main");
    m.tabIndex = -1;
    m.focus();
  });
  // nav links: from the reveal view, go home first, then jump to the section
  document.querySelectorAll('.top a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    if (!revealing()) return;
    e.preventDefault();
    const id = (a.getAttribute("href") || "").replace("#", "");
    startOver({ then: { id, search: a.id === "nav-search" } });   // scrolls once the home page is back
  }));

  renderWithin();
  renderBrowse();
  renderTeaser();
  try { await route(); }
  finally { document.documentElement.classList.remove("arriving"); }   // the letter (or home page) is ready; see index.html
}
start();
