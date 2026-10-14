/* AmbleBee Missions: picks and shows missions from catalog.json (built from missions/ by the GitHub Action).
   Everything runs in the visitor's browser. Nothing is sent anywhere; location stays in the tab. */
"use strict";

// ---- settings you might edit -----------------------------------------------------------------
const FORM_URL = "";   // paste the Google Form link here when it's ready; until then the button explains
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
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
};
const packIcon = (p) => ICON[p && p.icon] || ICON.compass;

// ---- state ---------------------------------------------------------------------------------------
const S = {
  catalog: null, missions: [], packs: [], packById: {},
  current: null,
  unit: readPref("unit") || (/^en-US/.test(navigator.language || "") ? "mi" : "km"),
  here: null,   // {lat, lon}: in memory only
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
      d != null ? h("span", { class: "dist" }, `${fmtDist(d)} as the bee flies`) : null,
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
  const shareBtn = h("button", { type: "button", class: "btn", onclick: () => shareMission(m, shareBtn) }, svg(ICON.share, 20), "Share this mission");
  return h("div", { class: "ticket-actions" },
    withRoll ? h("button", { type: "button", class: "btn primary", onclick: roll }, svg(ICON.dice, 22), "Roll again") : null,
    shareBtn);
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

function show(m, { scroll } = {}) {
  S.current = m;
  const slot = $("#ticket-slot");
  slot.replaceChildren();
  if (!m) {
    slot.append(h("div", { class: "empty" }, h("p", { class: "hand" }, "Nothing matches, yet."),
      "Try clearing a filter or two."));
    return;
  }
  const t = ticket(m);
  t.classList.add("pop");
  slot.append(t, actions(m, { withRoll: true }));
  history.replaceState(null, "", `#mission=${encodeURIComponent(m.full_id)}`);
  if (scroll) slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function roll(e) {
  const p = pool();
  if (!p.length) return show(null);
  const choices = p.length > 1 && S.current ? p.filter((m) => m.full_id !== S.current.full_id) : p;
  show(choices[Math.floor(Math.random() * choices.length)], { scroll: !!e && window.innerWidth < 860 });
}
function openDialog(m) {
  const body = $("#dialog-body");
  body.replaceChildren(ticket(m, { titleId: "dialog-title" }), actions(m));
  const d = $("#mission-dialog");
  if (typeof d.showModal === "function") d.showModal(); else show(m, { scroll: true });
}

// ---- browse --------------------------------------------------------------------------------------
function renderBrowse() {
  const f = readFilters();
  const matches = S.missions.filter((m) => passes(m, f));
  const n = matches.length, total = S.missions.length;
  $("#match-count").textContent = n === total ? `${total} missions to roll from` : `${n} of ${total} missions match`;
  $("#browse-count").textContent = n === total ? `${total} missions, ${S.packs.length} packs` : `${n} match your filters`;

  const wrap = $("#packs");
  wrap.replaceChildren();
  for (const p of S.packs) {
    const ms = matches.filter((m) => m.pack === p.id);
    if (!ms.length) continue;
    if (S.here) ms.sort((a, b) => (distM(a) ?? 0) - (distM(b) ?? 0) || a.number - b.number);
    wrap.append(h("section", { class: "pack", "aria-label": p.name },
      h("div", { class: "pack-head" },
        h("span", { class: "badge" }, svg(packIcon(p), 26)),
        h("div", {}, h("h3", {}, p.name), p.description ? h("p", {}, p.description) : null)),
      h("div", { class: "cards" }, ms.map((m) => {
        const d = distM(m);
        return h("button", { type: "button", class: "card", onclick: () => openDialog(m) },
          h("span", { class: "no" }, `Mission ${m.number}${m.place && m.place.area ? " · " + m.place.area : ""}`),
          h("h4", {}, m.name),
          h("p", { class: "s" }, m.short),
          h("span", { class: "meta" },
            d != null ? h("span", { class: "d" }, fmtDist(d)) : null,
            h("span", {}, L.mode[m.mode] || m.mode),
            h("span", {}, L.duration[m.duration] || m.duration),
            h("span", {}, L.cost[m.cost] || m.cost)));
      }))));
  }
  if (!wrap.children.length) wrap.append(h("p", { class: "none" }, "No missions match those filters. Try clearing one or two."));
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
function locate() {
  const status = $("#locate-status");
  if (!navigator.geolocation) { status.textContent = "This browser can't share a location."; return; }
  status.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition((pos) => {
    S.here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    status.textContent = "Got it. Distances are as the bee flies, so check the drive in your map app.";
    renderWithin(); refresh(false);
    if (S.current) show(S.current);
  }, () => { status.textContent = "Couldn't get your location. You can still browse everything."; },
  { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
}

// ---- wiring --------------------------------------------------------------------------------------
function refresh(reroll) {
  renderBrowse();
  if (reroll && S.current && !passes(S.current, readFilters())) roll();
}
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
  $("#pack-legend").replaceChildren(...S.packs.map((p) => h("li", {}, svg(packIcon(p), 20), h("b", {}, p.name), h("span", {}, `${p.count} missions`))));
  const src = data.source || {};
  $("#catalog-meta").textContent = `${src.name || "Missions"} · ${S.missions.length} missions · updated ${src.updated || "recently"}`;

  const form = $("#form-link");
  if (safeUrl(FORM_URL)) { form.href = FORM_URL; form.target = "_blank"; form.rel = "noopener"; }
  else { form.href = REPO_URL; $("#form-note").textContent = "The submission form opens soon. Until then, a pull request on GitHub works, or check back."; }
  $("#repo-link").href = REPO_URL;

  document.querySelectorAll('input[name="mode"], #filters input, #pack-select, #within-select')
    .forEach((el) => el.addEventListener("change", () => refresh(true)));
  $("#roll-btn").addEventListener("click", roll);
  $("#locate-btn").addEventListener("click", locate);
  document.querySelectorAll(".units button").forEach((b) => b.addEventListener("click", () => {
    S.unit = b.dataset.unit; writePref("unit", S.unit); renderWithin(); refresh(false); if (S.current) show(S.current);
  }));
  const toggle = $("#filters-toggle");
  toggle.addEventListener("click", () => {
    const panel = $("#filters"); panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    toggle.textContent = panel.hidden ? "More filters" : "Fewer filters";
  });
  $("#filters-reset").addEventListener("click", () => {
    document.querySelectorAll("#filters input").forEach((i) => { i.checked = false; });
    $("#within-select").value = ""; refresh(true);
  });
  $("#mission-dialog").addEventListener("click", (e) => { if (e.target.id === "mission-dialog") e.target.close(); });
  window.addEventListener("hashchange", () => { const m = fromHash(); if (m && m !== S.current) show(m); });

  renderWithin();
  renderBrowse();
  const linked = fromHash();
  if (linked) show(linked); else roll();
}
start();
