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
  const saved = readPref("zip") === S.zip;
  $("#zip-status").replaceChildren(h("span", { class: "zip-set" }, `Near ${S.zip}`),
    ": places close by plus missions you can do anywhere. Distances are as the bee flies.",
    h("button", { type: "button", class: "linkish zip-clear", onclick: clearZip }, "Clear"),
    saved ? null : h("button", { type: "button", class: "linkish zip-clear",
      onclick: () => { writePref("zip", S.zip); zipLine(); } }, "Remember on this device"));
}
async function setZip(e) {
  if (e) e.preventDefault();
  const status = $("#zip-status");
  const zip = ($("#zip-input").value || "").trim();
  if (!/^\d{5}$/.test(zip)) { status.textContent = "A ZIP code is 5 numbers, like 97201."; return; }
  if (!S.zips) {
    status.textContent = "Looking it up…";
    try {
      const r = await fetch(`${HOME}zips.json`);
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
  zipLine();
  renderWithin(); refresh();
  rerenderReveal();
}
function clearZip() {
  S.here = null; S.zip = null; $("#zip-input").value = "";
  dropPref("zip");
  if (S.packWidened && $("#pack-select").value === "all") $("#pack-select").value = "anywhere";
  S.packWidened = false;
  if (S.browse === "near") S.browse = null;
  $("#within-select").value = "";
  $("#zip-status").textContent = "Add a ZIP to see places close by, plus missions you can do anywhere. It's never sent anywhere.";
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
  finally { document.documentElement.classList.remove("arriving"); }   // the letter (or home page) is ready; see arrive.js
  const zip = readPref("zip");
  if (zip) { $("#zip-input").value = zip; setZip(); }
}
start();
