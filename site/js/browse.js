/* How many missions fit the picks: the line under the button, the Filters count and the sheet's total. */
"use strict";

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
function renderBrowse() {
  const f = readFilters();
  renderThemeCounts(f);
  const n = S.missions.filter((m) => passes(m, f)).length, total = S.missions.length;
  const active = activeFilters(f);
  const mc = $("#match-count");
  const word = (k) => (k === 1 ? "mission" : "missions");
  const narrowed = active > 0 || f.within != null;   // pack or the mood picker alone aren't "filters"
  mc.className = "match" + (narrowed && n !== total ? " filtered" : "") + (n === 0 ? " zero" : "");
  const placesInReach = S.here && S.missions.some((m) => distM(m) != null && passes(m, { ...f, pack: "all" }));
  // nothing picked yet: the line stays empty, the envelope already says how many there are
  mc.textContent = !narrowed ? ""
    : !active && n && S.here && !placesInReach ? `${n} ${word(n)} you can do anywhere. No places within ${f.within} ${S.unit} of ${S.zip} yet.`
    : !active && n && S.here ? `${n} ${word(n)} to pick from, within ${f.within} ${S.unit} of ${S.zip}`
    : n === 0 ? "No missions fit these filters. Try clearing one."
    : n === 1 ? "Only 1 mission fits these filters"
    : `Picking from ${n} ${word(n)} that fit these filters`;
  $("#filters-match").replaceChildren(n === 0 ? "No missions fit. Try clearing one."
    : h("span", {}, h("b", {}, String(n)), ` ${word(n)} ${active ? "with these filters" : "to pick from"}`));
  const go = $("#sheet-open");
  go.textContent = n ? `Open a mission · ${n}` : "Nothing fits yet";
  go.disabled = !n;
  $("#match-clear").hidden = n > 0;
  if (S.booted && mc.textContent) announce(mc.textContent);
  const fc = $("#filters-count");
  fc.hidden = !active; fc.textContent = String(active);
  fc.setAttribute("aria-label", `${active} on`);
  syncUrl();
}
