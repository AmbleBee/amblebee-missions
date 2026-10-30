/* Near you and the start-up wiring. */
"use strict";

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
function zipLine() {
  const canSave = S.zip !== "your location" && readPref("zip") !== S.zip;
  $("#zip-status").replaceChildren(h("span", { class: "zip-set" }, `Near ${S.zip}`),
    ": places close by plus missions you can do anywhere. Distances are as the bee flies.",
    h("button", { type: "button", class: "linkish zip-clear", onclick: clearZip }, "Clear"),
    canSave ? h("button", { type: "button", class: "linkish zip-clear",
      onclick: () => { writePref("zip", S.zip); zipLine(); } }, "Remember on this device") : null);
}
function setPlace(lat, lon, label) {
  const first = !S.here;
  S.here = { lat, lon }; S.zip = label;
  if (first && $("#pack-select").value === "anywhere") { $("#pack-select").value = "all"; S.packWidened = true; }
  renderWithin();
  if (first && !$("#within-select").value) $("#within-select").value = String(WITHIN[S.unit][2]);
  if (first && (S.browse === "anywhere" || S.browse === "all" || !S.browse)) S.browse = "near";
  zipLine();
  renderWithin(); refresh();
  rerenderReveal();
}
async function loadList(url, key) {
  const r = await fetch(`${HOME}${url}`);
  if (!r.ok) throw new Error(r.status);
  return (await r.json())[key];
}
// a ZIP goes straight to its point; anything with letters is a city
async function setZip(e) {
  if (e) e.preventDefault();
  const status = $("#zip-status");
  const text = ($("#zip-input").value || "").trim();
  if (!text) { status.textContent = "Type a ZIP code or a city, like 97201 or Portland, OR."; return; }
  if (/[a-z]/i.test(text)) { findCity(text); return; }
  if (!/^\d{5}$/.test(text)) { status.textContent = "A ZIP code is 5 numbers, like 97201."; return; }
  if (!S.zips) {
    status.textContent = "Looking it up…";
    try { S.zips = (await loadList("zips.json", "zips")) || {}; }
    catch (err) { status.textContent = "ZIP lookup isn't available right now. You can still browse everything."; return; }
  }
  const c = S.zips[text];
  if (!c) { status.textContent = `Couldn't find ${text}. Double-check the number? (US ZIP codes only for now.)`; return; }
  setPlace(c[0], c[1], text);
}
// cities: [name, state, lat, lon], biggest first. "Portland, OR" or "Portland OR" settles it;
// "Portland" alone offers the choices
async function findCity(text) {
  const status = $("#zip-status");
  if (!S.cities) {
    status.textContent = "Looking it up…";
    try { S.cities = (await loadList("cities.json", "cities")) || []; }
    catch (err) { status.textContent = "City lookup isn't available right now. A ZIP code should still work."; return; }
  }
  const named = /^(.*?)[,\s]+([a-z]{2})$/i.exec(text);
  const state = named && S.cities.some((c) => c[1] === named[2].toUpperCase()) ? named[2].toUpperCase() : null;
  const name = fold(state ? named[1] : text.replace(/,\s*$/, "")).replace(/\bsaint\b/g, "st.").trim();
  const inState = (c) => !state || c[1] === state;
  let found = S.cities.filter((c) => fold(c[0]) === name && inState(c));
  if (!found.length) found = S.cities.filter((c) => fold(c[0]).startsWith(name) && inState(c));
  const use = (c) => { $("#zip-input").value = `${c[0]}, ${c[1]}`; setPlace(c[2], c[3], `${c[0]}, ${c[1]}`); };
  if (!found.length) { status.textContent = `Couldn't find ${text}. Try adding the state, like Portland, OR, or use a ZIP code.`; return; }
  if (found.length === 1 || state) { use(found[0]); return; }
  status.replaceChildren("Which one? ", ...found.slice(0, 6).map((c) =>
    h("button", { type: "button", class: "linkish zip-clear", onclick: () => use(c) }, `${c[0]}, ${c[1]}`)),
  found.length > 6 ? h("span", { class: "zip-more" }, `Not listed? Add the state, like ${found[0][0]}, ${found[0][1]}.`) : "");
}
// after "Use my location": the closest ZIP goes in the box, so it's easy to see the spot looks right.
// Worked out here in the browser. Nothing is filled in if no ZIP is close, like outside the US
async function showNearestZip(lat, lon) {
  try { S.zips = S.zips || (await loadList("zips.json", "zips")) || {}; }
  catch (err) { return; }
  let nearest = null, least = NEAREST_ZIP_M;
  for (const [zip, c] of Object.entries(S.zips)) {
    const d = meters([lat, lon], c);
    if (d < least) { least = d; nearest = zip; }
  }
  if (nearest && S.zip === "your location" && !$("#zip-input").value) $("#zip-input").value = nearest;
}
function useLocation() {
  const status = $("#zip-status");
  if (!navigator.geolocation) { status.textContent = "This browser can't share a location. Try a ZIP code or city."; return; }
  status.textContent = "Asking your browser…";
  navigator.geolocation.getCurrentPosition((p) => {
    $("#zip-input").value = "";
    setPlace(p.coords.latitude, p.coords.longitude, "your location");
    showNearestZip(p.coords.latitude, p.coords.longitude);
  }, () => { status.textContent = "Couldn't get your location. Try a ZIP code or city instead."; },
  { timeout: 10000, maximumAge: 600000 });
}
function clearZip() {
  S.here = null; S.zip = null; $("#zip-input").value = "";
  dropPref("zip");
  if (S.packWidened && $("#pack-select").value === "all") $("#pack-select").value = "anywhere";
  S.packWidened = false;
  if (S.browse === "near") S.browse = null;
  $("#within-select").value = "";
  $("#zip-status").textContent = "Add a ZIP or city to see places close by, plus missions you can do anywhere. It's never sent anywhere.";
  renderWithin(); refresh();
  rerenderReveal();
}

// ---- shareable links: picks live in the address, so a copied link or a refresh keeps them ------------
// Where you are never goes in the address, so sharing a link can't share your location.
const QUERY_LISTS = ["who", "duration", "effort", "cost", "setting", "time", "themes"];
function filterQuery() {
  const f = readFilters(), q = new URLSearchParams();
  if (f.mode !== "any") q.set("mode", f.mode);
  if (f.pack !== "anywhere") q.set("pack", f.pack);
  QUERY_LISTS.forEach((k) => { if (f[k].length) q.set(k, f[k].join(",")); });
  if (f.inSeason) q.set("season", "now");
  if (f.goNow) q.set("go", "now");
  if (S.browse && !["all", "near"].includes(S.browse)) q.set("list", S.browse);
  if (S.q.trim()) q.set("q", S.q.trim());
  if (S.sort) q.set("sort", S.sort);
  const text = q.toString();
  return text ? `?${text}` : "";
}
function syncUrl() {
  if (location.pathname !== HOME) return;   // a mission pop-up has its own address
  const url = `${HOME}${filterQuery()}${location.hash}`;
  if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, "", url);
}
function readQuery() {
  const q = new URLSearchParams(location.search);
  const mode = document.querySelector(`input[name="mode"][value="${CSS.escape(q.get("mode") || "any")}"]`);
  if (mode) mode.checked = true;
  if (q.has("pack") && [...$("#pack-select").options].some((o) => o.value === q.get("pack"))) $("#pack-select").value = q.get("pack");
  for (const k of QUERY_LISTS) {
    const picks = (q.get(k) || "").split(",");
    document.querySelectorAll(`[data-filter="${k}"] input`).forEach((i) => { i.checked = picks.includes(i.value); });
  }
  $("#f-season").checked = q.get("season") === "now";
  $("#f-gonow").checked = q.get("go") === "now";
  if (S.packById[q.get("list")]) S.browse = q.get("list");
  S.q = (q.get("q") || "").slice(0, 80);
  $("#search-input").value = S.q;
  if (SORTS[q.get("sort")]) S.sort = q.get("sort");
}

// ---- wiring --------------------------------------------------------------------------------------
function refresh() {
  renderBrowse();
  if (!revealing()) renderTeaser();
}
// a sealed letter stays sealed: it picks up the new distance when it's opened
const rerenderReveal = () => { if (revealing() && S.current && !$("#reveal-slot .env")) showReveal(S.current, { from: S.revealFrom }); };
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
  $("#catalog-meta").textContent = `${src.name || "Missions"} · ${S.missions.length} live missions · updated ${prettyDate(src.updated)}`;

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
  $("#browse-sort").addEventListener("change", (e) => { S.sort = e.target.value; renderBrowse(); });
  $("#use-location").addEventListener("click", useLocation);
  $("#browse-share").addEventListener("click", async (e) => {
    const b = e.target;
    try { await navigator.clipboard.writeText(`${location.origin}${HOME}${filterQuery()}`); b.textContent = "Copied!"; }
    catch (err) { b.textContent = "Copy it from the address bar"; }
    setTimeout(() => { b.textContent = "Copy a link to this list"; }, 2200);
  });
  let searchTimer = null;
  const sInput = $("#search-input");
  sInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.q = sInput.value; renderBrowse(); }, 120);
  });
  sInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { sInput.value = ""; S.q = ""; renderBrowse(); } });
  document.querySelectorAll(".units button").forEach((b) => b.addEventListener("click", () => {
    const sel = $("#within-select"), at = WITHIN[S.unit].indexOf(Number(sel.value));   // keep the same step: 30 mi becomes 50 km
    S.unit = b.dataset.unit; writePref("unit", S.unit); renderWithin();
    if (at >= 0) sel.value = String(WITHIN[S.unit][at]);
    refresh(); rerenderReveal();
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
  ["#browse-clear", "#filters-reset", "#match-clear"].forEach((id) => $(id).addEventListener("click", clearAll));
  // a tap on the dim area closes a pop-up, but only if the press began there (dragging out of a text box doesn't count)
  const closeOnBackdrop = (d, keepOpen) => {
    let began = false;
    d.addEventListener("pointerdown", (e) => { began = e.target === d; });
    d.addEventListener("click", (e) => { if (e.target === d && began && !(keepOpen && keepOpen())) d.close(); });
  };
  closeOnBackdrop($("#mission-dialog"));
  // a card with writing on it stays open; X, Cancel and Escape still close it, and the draft is kept
  closeOnBackdrop($("#gift-dialog"), () => [...document.querySelectorAll("#gift-body .gc-to, #gift-body .gc-note")].some((el) => el.value.trim()));
  $("#mission-dialog").addEventListener("close", () => { if (history.state && history.state.amble === "popup") history.back(); });
  window.addEventListener("popstate", () => {
    if (history.state && history.state.amble === "popup") { location.reload(); return; }   // Forward: show the real page
    if ($("#mission-dialog").open) $("#mission-dialog").close();
    if ($("#gift-dialog").open) $("#gift-dialog").close();   // the draft is kept
    route();
  });
  window.addEventListener("hashchange", route);
  $("#reveal-adjust").addEventListener("click", () => startOver({ filters: true }));
  // skip link: move focus without touching the address, which would close an open mission
  $(".skip").addEventListener("click", (e) => {
    e.preventDefault();
    const m = $("#main");
    m.tabIndex = -1;
    m.focus();
  });
  // header links to sections of this page: stay here, so filters in the address survive
  document.querySelectorAll('.top a[href^="/#"]').forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const id = a.getAttribute("href").slice(2), search = id === "search", target = search ? "browse" : id;
    if (revealing()) { startOver({ then: { id: target, search } }); return; }
    $(`#${target}`).scrollIntoView({ behavior: REDUCED() ? "auto" : "smooth" });
    if (search) setTimeout(() => sInput.focus({ preventScroll: true }), 300);
  }));

  readQuery();
  renderWithin();
  renderBrowse();
  renderTeaser();
  try { await route(); }
  finally { document.documentElement.classList.remove("arriving"); }   // the letter (or home page) is ready; see arrive.js
  if (location.hash === "#search") { $("#browse").scrollIntoView(); sInput.focus({ preventScroll: true }); }   // from another page's menu
  const zip = readPref("zip");
  if (zip) { $("#zip-input").value = zip; setZip(); }
}
start();
