/* AmbleBee Missions: picks and shows missions from catalog.json (built from missions/ by the GitHub Action).
   Everything runs in the visitor's browser. Nothing is sent anywhere; location stays in the tab. */
"use strict";

// ---- settings you might edit -----------------------------------------------------------------
const FORM_URL = "https://forms.gle/V8UZRwmDrLwzQpuM6";   // paste the Google Form link here when it's ready; until then the button explains
const REPO_URL = "https://github.com/AmbleBee/amblebee-missions";

// ---- labels ---------------------------------------------------------------------------------
const L = {
  mode: { date: "Date", adventure: "Adventure", both: "Date or adventure" },
  duration: { short: "1-3 hours", "half-day": "Half day", "all-day": "All day" },
  effort: { easy: "Easy", moderate: "Moderate", hard: "Hard" },
  cost: { free: "Free", "$": "Under $20", "$$": "$20-60", "$$$": "Over $60" },
  setting: { indoor: "Indoors", outdoor: "Outdoors", either: "Indoors or out" },
  time: { morning: "Best in the morning", daytime: "Daytime", evening: "Best in the evening", night: "At night" },
  check: { hours: "opening hours", tickets: "tickets", reservation: "a reservation", seasonal: "if it's open this season", conditions: "weather and trail conditions" },
  who: { solo: "just you", friends: "friends", family: "family", kids: "kids" },
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
const NEAR_MAX = 24;
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
const ICON = {   // fixed artwork only (never mission data)
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  evergreen: '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  needle: '<path d="M12 2v6M9 8h6l-1 3h-4zM10.5 11l-1.5 10M13.5 11l1.5 10M8 21h8"/>',
  arch: '<path d="M4 21C4 9 8 4 12 4s8 5 8 17"/><path d="M7.5 21c0-9 2-13 4.5-13s4.5 4 4.5 13"/>',
  fleur: '<path d="M12 3c-2 3-2 6 0 9 2-3 2-6 0-9zM12 12c-3-1-6 0-7 3 3 1 5 0 7-3zM12 12c3-1 6 0 7 3-3 1-5 0-7-3zM9 16h6M12 12v9"/>',
  bridge: '<path d="M2 18h20M4 18v-5M20 18v-5M2 13c4-5 16-5 20 0M8 18v-6M16 18v-6M12 18v-7"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
};
const packIcon = (p) => ICON[p && p.icon] || ICON.compass;

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
    cost: checked("cost"), setting: checked("setting"),
    inSeason: $("#f-season").checked, goNow: $("#f-gonow").checked,
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
  if (f.inSeason && m.season !== "any" && !(m.season || []).includes(seasonNow())) return false;
  if (f.goNow && (m.check_ahead || []).some((c) => c === "tickets" || c === "reservation")) return false;
  if (f.within != null) { const d = distM(m); if (d != null && d > f.within * M_PER[S.unit]) return false; }
  return true;
}
function activeFilters(f) {
  return f.who.length + f.duration.length + f.effort.length + f.cost.length + f.setting.length
    + (f.inSeason ? 1 : 0) + (f.goNow ? 1 : 0) + (f.within != null ? 1 : 0);
}
const pool = () => { const f = readFilters(); return S.missions.filter((m) => passes(m, f)); };

// ---- the ticket ---------------------------------------------------------------------------------
function packTotal(m) {
  const p = S.packById[m.pack];
  const top = Math.max(0, ...S.missions.filter((x) => x.pack === m.pack).map((x) => x.number || 0));
  return Math.max(p ? p.count : 0, top);
}
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
    notes.push(h("p", {}, svg(ICON.clock, 18), `Check before you go: ${list(m.check_ahead.map((c) => L.check[c] || c))}`));
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
      place, extras,
      h("p", { class: "source" }, svg(packIcon(pack), 18),
        h("span", {}, "Mission ", h("b", {}, `${m.number || "?"} of ${packTotal(m)}`), " in ", h("b", {}, pack.name)),
        h("code", {}, m.full_id))));
}

function actions(m, { withRoll } = {}) {
  return h("div", { class: "ticket-actions" },
    withRoll ? h("button", { type: "button", class: "btn primary", onclick: roll }, svg(ICON.mail, 22), "Open another") : null,
    shareButtons(m));
}
// two ways to share: a plain link, or a sealed "gift" link with names and a hidden note
function shareButtons(m) {
  const plain = h("button", { type: "button", class: "btn", onclick: () => shareMission(m, plain) }, svg(ICON.share, 20), "Share link");
  const gift = h("button", { type: "button", class: "btn", onclick: () => openGiftForm(m) }, svg(ICON.mail, 20), "Send with a note");
  return [plain, gift];
}
async function shareMission(m, btn) {
  const url = `${location.origin}${location.pathname}#mission=${encodeURIComponent(m.full_id)}`;
  try {
    if (navigator.share) { await navigator.share({ title: m.name, text: m.short, url }); return; }
    await navigator.clipboard.writeText(url);
    btn.lastChild.textContent = "Link copied";
  } catch (e) {
    if (e && e.name === "AbortError") return;
    prompt("Copy this link:", url);
  }
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

// "Send with a note": you write right on the card, pick who it's for, then seal it
function openGiftForm(m) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const pack = S.packById[m.pack] || { name: m.pack };
  const draft = S.giftDraft && S.giftDraft.m === m.full_id ? S.giftDraft : null;
  let theme = themeOf(draft ? draft.th : readPref("giftTheme"));
  const lastSign = {};   // remembers the sign-off picked for each theme while you flip between them
  if (draft) lastSign[theme] = draft.s;

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
  from.value = draft ? draft.f : (readPref("giftFrom") || "");
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
    h("p", { class: "hand gift-kicker" }, "Send it sealed"),
    h("h2", { id: "gift-title" }, "Write them a card"),
    h("p", { class: "gift-mission" }, svg(packIcon(pack), 18), h("span", {}, h("b", {}, m.name), ` · ${pack.name}`)),
    h("p", { class: "gift-label" }, "Who's it for?"),
    chips,
    h("div", { class: "gift-desk" }, card, count),
    err,
    h("div", { class: "gift-actions" },
      h("button", { type: "submit", class: "btn primary" }, svg(ICON.mail, 20), "Seal it"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Cancel")));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = cleanGift({ m: m.full_id, f: from.value, t: to.value, n: note.value, th: theme, s: sign.value });
    if (!g.t || !g.f) {
      err.textContent = !g.t ? "Who's it for? Write their name at the top of the card." : "Sign your name at the bottom so they know who it's from.";
      (!g.t ? to : from).focus(); return;
    }
    err.textContent = "";
    writePref("giftFrom", g.f); writePref("giftTheme", g.th); writePref("giftSign", g.s);
    S.giftDraft = g;
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

  const box = h("input", { class: "gift-link", readonly: true, "aria-label": "Your gift link", value: url, onfocus: (e) => e.target.select() });
  const copy = h("button", { type: "button", class: "btn primary" }, svg(ICON.link, 20), "Copy link");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); copy.lastChild.textContent = "Copied!"; }
    catch (e) { box.focus(); box.select(); copy.lastChild.textContent = "Press copy on your keyboard"; }
  });
  const share = navigator.share ? h("button", { type: "button", class: "btn" }, svg(ICON.share, 20), "Share…") : null;
  if (share) share.addEventListener("click", async () => {
    try { await navigator.share({ title: "An AmbleBee mission", text: "You've got mail from AmbleBee. Open the envelope:", url }); } catch (e) { /* closed the sheet */ }
  });
  const done = h("div", { class: "gift-done", hidden: true },
    h("p", { class: "gift-lede" }, g.n
      ? `Send ${g.t} this link however you like. Your names are on the envelope; the note and the mission stay inside until they open it.`
      : `Send ${g.t} this link however you like. Your names are on the envelope; the mission stays a surprise until they open it.`),
    box,
    h("div", { class: "gift-actions" }, copy, share,
      h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" }, "Preview")),
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

// ---- home teaser + the reveal view ---------------------------------------------------------------
const revealing = () => document.body.classList.contains("revealing");
// ---- the sealed letter: flips over, the flap lifts, the mission card slides out ------------------
const REDUCED = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  return choices[Math.floor(Math.random() * choices.length)];
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
  if (replace || revealing()) history.replaceState(history.state, "", url);
  else history.pushState({ amble: "reveal" }, "", url);
  showReveal(m, { from: "roll", growFrom });
}
function rollSummary() {
  const f = readFilters();
  const parts = [f.mode === "date" ? "A date" : f.mode === "adventure" ? "An adventure" : "Anything",
    f.pack === "all" ? "Every pack" : (S.packById[f.pack] || {}).name || f.pack];
  const n = activeFilters(f);
  if (n) parts.push(`${n} ${n === 1 ? "filter" : "filters"}`);
  const p = pool().length;
  parts.push(`picked from ${p} ${p === 1 ? "mission" : "missions"}`);
  return parts.join(" · ");
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
  $("#reveal-summary").hidden = sealed;
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
  $("#reveal-actions").replaceChildren(
    h("button", { type: "button", class: "btn primary", onclick: roll }, svg(ICON.mail, 22), linked ? "Open your own" : "Open another"),
    ...shareButtons(m),
    h("button", { type: "button", class: "btn", onclick: () => startOver() }, "Start over"));
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
// Back from the reveal goes home. A reveal opened from the home page pushes one history entry;
// re-rolls replace it, so Back always lands on the home page.
function startOver({ filters = false } = {}) {
  S.afterHome = filters ? "filters" : null;
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
      showHome();
      $("#ticket-slot").replaceChildren(envelope({ title: "This letter got lost in the mail.",
        sub: gift ? "That mission isn't in the catalog anymore. Open one of your own?" : "The link may have been cut off when it was copied. Ask them to send it again, or open your own.",
        to: "you", button: "Open your own",
        onOpen: () => { history.replaceState(null, "", location.pathname + location.search); S.shownGift = null; S.giftKey = null; S.giftP = Promise.resolve(null); openFromHome(); } }));
    }
    S.booted = true; return;
  }
  S.shownGift = null;
  const m = fromHash();
  if (m) {
    if (!revealing() || m !== S.current) {
      const from = S.rolledId === m.full_id ? "roll" : "link";
      showReveal(m, { from, sealed: from === "link" && !S.booted });
    }
    S.booted = true; return;
  }
  S.booted = true;
  if (revealing() || !$("#ticket-slot").firstChild) showHome();
  const after = S.afterHome; S.afterHome = null;
  if (after === "filters") {
    $("#filters").hidden = true; $("#filters-toggle").click();
  } else if (after === "top") {
    window.scrollTo({ top: 0 });
  }
}
function roll() {
  if (!revealing()) { if (!pool().length) { startOver(); return; } openFromHome(); return; }
  const m = pickMission();
  if (!m) { startOver(); return; }
  S.rolledId = m.full_id;
  history.replaceState(history.state, "", `#mission=${encodeURIComponent(m.full_id)}`);
  showReveal(m, { from: "roll", animate: true });
}
function openDialog(m) {
  const body = $("#dialog-body");
  body.replaceChildren(ticket(m, { titleId: "dialog-title" }), actions(m));
  const d = $("#mission-dialog");
  if (typeof d.showModal === "function") d.showModal(); else { S.rolledId = null; history.pushState({ amble: "reveal" }, "", `#mission=${encodeURIComponent(m.full_id)}`); showReveal(m, { from: "link" }); }
}

// ---- browse --------------------------------------------------------------------------------------
// search: every word must appear somewhere in the mission; matches in the name rank highest
const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-_/]/g, " ");
function searchText(m) {
  if (m._hay) return m._hay;
  const pack = S.packById[m.pack] || {};
  const pl = m.place || {};
  const parts = [m.name, m.short, m.description, (m.tags || []).join(" "), pl.name, pl.area, pl.address,
    pack.name, pack.region, m.credit, m.id, (m.gear || []).map((g) => g.item).join(" "),
    m.for_kids && m.for_kids.short, (m.season === "any" ? [] : m.season || []).join(" "),
    L.mode[m.mode], L.setting && L.setting[m.setting], L.time && L.time[m.time_of_day]];
  m._name = fold(m.name);
  m._tags = (m.tags || []).map(fold);
  return (m._hay = fold(parts.filter(Boolean).join(" ")));
}
function searchScore(m, words) {
  const hay = searchText(m);
  let score = 0;
  for (const w of words) {
    if (!hay.includes(w)) return 0;
    score += m._name.includes(w) ? 5 : m._tags.some((t) => t.includes(w)) ? 3 : 1;
  }
  return score;
}
const searchWords = () => fold(S.q).split(/\s+/).filter((w) => w.length > 0);
function renderBrowse() {
  const f = readFilters();
  const matches = S.missions.filter((m) => passes(m, f));
  const n = matches.length, total = S.missions.length;
  const active = activeFilters(f);
  const mc = $("#match-count");
  const word = (k) => (k === 1 ? "mission" : "missions");
  mc.className = "match" + (n === total ? "" : " filtered") + (n === 0 ? " zero" : "");
  mc.textContent = n === total ? `${total} missions to pick from`
    : n === 0 ? "No missions fit these filters. Try clearing one."
    : n === 1 ? "Only 1 mission fits these filters"
    : `Picking from ${n} ${word(n)} that fit these filters`;
  const fm = $("#filters-match");
  fm.replaceChildren(n === 0 ? "No missions fit. Try clearing one."
    : h("span", {}, h("b", {}, String(n)), ` ${word(n)} ${n === total ? "(everything)" : "with these filters"}`));
  const fc = $("#filters-count");
  fc.hidden = !active; fc.textContent = String(active);
  fc.setAttribute("aria-label", `${active} on`);
  $("#browse-count").textContent = n === total ? `${total} missions, ${S.packs.length} packs` : `${n} match your filters`;

  renderBrowsePick(matches);
  const wrap = $("#packs");
  wrap.replaceChildren();
  const words = searchWords();
  const searching = words.length > 0;
  $("#search-hint").hidden = !searching;
  $(".pack-field").hidden = searching;
  const card = (m) => {
    const d = distM(m);
    const pack = S.packById[m.pack];
    return h("button", { type: "button", class: "card", onclick: () => openDialog(m) },
      h("span", { class: "no" }, (S.browse === "near" || searching) && pack ? `${pack.name} · Mission ${m.number}`
        : `Mission ${m.number}${m.place && m.place.area ? " · " + m.place.area : ""}`),
      h("h4", {}, m.name),
      h("p", { class: "s" }, m.short),
      h("span", { class: "meta" },
        d != null ? h("span", { class: "d" }, fmtDist(d)) : null,
        h("span", {}, L.mode[m.mode] || m.mode),
        h("span", {}, L.duration[m.duration] || m.duration),
        h("span", {}, L.cost[m.cost] || m.cost)));
  };
  if (searching) {
    const found = matches.map((m) => [searchScore(m, words), m]).filter(([sc]) => sc > 0)
      .sort((a, b) => b[0] - a[0] || (S.here ? (distM(a[1]) ?? 1e12) - (distM(b[1]) ?? 1e12) : 0)
        || a[1].name.localeCompare(b[1].name))
      .map(([, m]) => m);
    $("#browse-count").textContent = `${found.length} ${found.length === 1 ? "mission matches" : "missions match"} "${S.q.trim()}"`;
    if (found.length) wrap.append(h("section", { class: "pack", "aria-label": "Search results" },
      h("div", { class: "cards" }, found.map(card))));
    else wrap.append(h("p", { class: "none" },
      matches.length < S.missions.length ? `Nothing matches "${S.q.trim()}" with your filters on. Try clearing a filter or a different word.`
        : `Nothing matches "${S.q.trim()}". Try a different word, like a town, a place or an activity.`));
    return;
  }
  if (S.browse === "near" && S.here) {
    const near = matches.filter((m) => distM(m) != null).sort((x, y) => distM(x) - distM(y)).slice(0, NEAR_MAX);
    if (near.length) wrap.append(h("section", { class: "pack", "aria-label": "Closest to your ZIP" },
      h("div", { class: "pack-head" },
        h("span", { class: "badge" }, svg(ICON.pin, 26)),
        h("div", {}, h("h3", {}, `Closest to ${S.zip}`),
          h("p", {}, `The ${near.length} nearest places, as the bee flies. Amble Anywhere missions work from any ZIP.`))),
      h("div", { class: "cards" }, near.map(card))));
  } else {
    for (const p of S.packs) {
      if (S.browse !== "all" && S.browse !== p.id) continue;
      const ms = matches.filter((m) => m.pack === p.id);
      if (!ms.length) continue;
      if (S.here) ms.sort((x, y) => (distM(x) ?? 0) - (distM(y) ?? 0) || x.number - y.number);
      wrap.append(h("section", { class: "pack", "aria-label": p.name },
        h("div", { class: "pack-head" },
          h("span", { class: "badge" }, svg(packIcon(p), 26)),
          h("div", {}, h("h3", {}, p.name), p.description ? h("p", {}, p.description) : null)),
        h("div", { class: "cards" }, ms.map(card))));
    }
  }
  if (!wrap.children.length) wrap.append(h("p", { class: "none" },
    matches.length ? "Nothing in this pack fits your filters. Try another pack, or clear a filter or two."
      : "No missions match those filters. Try clearing one or two."));
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
  if (!S.browse || ![...sel.options].some((o) => o.value === S.browse)) S.browse = S.packById.anywhere ? "anywhere" : "all";
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
  if (first && (S.browse === "anywhere" || S.browse === "all" || !S.browse)) S.browse = "near";
  status.replaceChildren(h("span", { class: "zip-set" }, `Distances from ${zip}`),
    ", as the bee flies. Check the drive in your map app.",
    h("button", { type: "button", class: "linkish zip-clear", onclick: clearZip }, "Clear"));
  renderWithin(); refresh();
  rerenderReveal();
}
function clearZip() {
  S.here = null; S.zip = null; $("#zip-input").value = "";
  if (S.browse === "near") S.browse = null;
  $("#within-select").value = "";
  $("#zip-status").textContent = "Home, or wherever the trip starts. Your ZIP is looked up in this browser tab and never sent anywhere.";
  renderWithin(); refresh();
  rerenderReveal();
}

// ---- wiring --------------------------------------------------------------------------------------
function refresh() {
  renderBrowse();
  if (!revealing()) renderTeaser();
}
const rerenderReveal = () => { if (revealing() && S.current) showReveal(S.current, { from: S.revealFrom }); };
function fromHash() {
  const m = /mission=([^&]+)/.exec(location.hash);
  return m ? S.missions.find((x) => x.full_id === decodeURIComponent(m[1])) : null;
}

async function start() {
  let data;
  try {
    const r = await fetch("catalog.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch (e) {
    $("#ticket-slot").replaceChildren(h("div", { class: "empty" }, h("p", { class: "hand" }, "The missions didn't load."), "Try refreshing the page."));
    return;
  }
  S.catalog = data;
  S.missions = data.missions || [];
  const order = (p) => (p.id === "anywhere" ? "0" : p.id === "general" ? "2" : "1") + (p.name || p.id);
  S.packs = (data.packs || []).filter((p) => p.count).sort((a, b) => order(a).localeCompare(order(b)));
  S.packById = Object.fromEntries(S.packs.map((p) => [p.id, p]));

  const sel = $("#pack-select");
  S.packs.forEach((p) => sel.append(h("option", { value: p.id }, p.name)));
  renderLegend();
  const src = data.source || {};
  $("#catalog-meta").textContent = `${src.name || "Missions"} · ${S.missions.length} missions · updated ${src.updated || "recently"}`;

  const form = $("#form-link");
  if (safeUrl(FORM_URL)) { form.href = FORM_URL; form.target = "_blank"; form.rel = "noopener"; }
  else { form.href = REPO_URL; $("#form-note").textContent = "The submission form opens soon. Until then, a pull request on GitHub works, or check back."; }
  $("#repo-link").href = REPO_URL;

  document.querySelectorAll('input[name="mode"], #filters input[type="checkbox"], #pack-select, #within-select')
    .forEach((el) => el.addEventListener("change", () => refresh()));
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
  $("#filters-reset").addEventListener("click", () => {
    document.querySelectorAll("#filters input").forEach((i) => { i.checked = false; });
    $("#within-select").value = ""; refresh();
  });
  $("#mission-dialog").addEventListener("click", (e) => { if (e.target.id === "mission-dialog") e.target.close(); });
  $("#gift-dialog").addEventListener("click", (e) => { if (e.target.id === "gift-dialog") e.target.close(); });
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);
  $("#reveal-adjust").addEventListener("click", () => startOver({ filters: true }));
  // nav links: from the reveal view, go home first, then jump to the section
  document.querySelectorAll(".top nav a").forEach((a) => a.addEventListener("click", (e) => {
    if (!revealing()) return;
    e.preventDefault();
    const id = (a.getAttribute("href") || "").replace("#", "");
    startOver();
    setTimeout(() => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth" });
      if (a.id === "nav-search") $("#search-input").focus({ preventScroll: true }); }, 60);
  }));

  renderWithin();
  renderBrowse();
  renderTeaser();
  route();
}
start();
