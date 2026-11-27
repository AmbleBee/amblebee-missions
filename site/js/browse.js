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
// When the filters leave nothing: "Want us to look into it?" sends the ZIP (or the city typed), the distance and the
// filters to AmbleBee, only when tapped (AmbleBee Intake, app/nomatch.py). Nothing about the person, and never sent otherwise.
function zeroPayload() {
  const f = readFilters(), here = S.here ? S.zip || "" : "";
  const zip = /^\d{5}$/.test(here) ? here : "";
  const city = !zip && /,\s*[A-Z]{2}$/.test(here) ? here : "";
  const picks = { mode: f.mode, pack: f.pack, season: f.inSeason, go: f.goNow, new: f.hideDone };
  QUERY_LISTS.forEach((k) => { if (f[k].length) picks[k] = f[k]; });
  return { zip, city, state: window.AmbleUtil.placeState(zip || city), within: (zip || city) && f.within != null ? f.within : null,
    unit: S.unit, f: picks };
}
function zeroAsk() {
  const p = zeroPayload(), key = JSON.stringify(p), where = p.zip || p.city;
  S.askedZero = S.askedZero || new Set();
  const thanks = () => h("p", { class: "zero-asked" }, "Thanks! We'll look into it.");
  if (S.askedZero.has(key)) return thanks();
  const btn = h("button", { type: "button", class: "btn small" }, "Look into it");
  const msg = h("span", { role: "status" });
  const near = !where ? "" : p.within != null ? ` within ${p.within} ${p.unit} of ${where}` : ` near ${where}`;
  const box = h("div", { class: "zero-ask-in", "data-key": key },
    h("p", { class: "zero-ask-q" }, `Nothing fits${near}. Want us to look into it? `, btn, msg),
    h("p", { class: "zero-ask-note" }, p.zip ? "Sends your ZIP and these filters to AmbleBee, nothing else."
      : p.city ? "Sends the city you typed and these filters to AmbleBee, nothing else." : "Sends these filters to AmbleBee, nothing else."));
  btn.addEventListener("click", () => {
    btn.disabled = true; msg.textContent = "";
    fetch(window.AmbleUtil.API + "/no-match", { method: "POST", headers: { "Content-Type": "text/plain" }, body: key })
      .then((r) => r.json())
      .then((b) => {
        if (!b.ok) throw new Error(b.error || "bad");
        S.askedZero.add(key);
        // every copy of it (the sheet's, and the envelope's behind it) says thanks
        document.querySelectorAll(".zero-ask-in").forEach((el) => { if (el.dataset.key === key) el.replaceWith(thanks()); });
      })
      .catch(() => { btn.disabled = false; msg.textContent = " That didn't go through. Try again in a moment."; });   // a refusal too, not just the network
  });
  return box;
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
  const za = $("#zero-ask");   // in "Where are you?": offer to look into it when nothing fits
  if (za) { za.hidden = n > 0; za.replaceChildren(...(n ? [] : [zeroAsk()])); }
  if (S.booted && mc.textContent) announce(mc.textContent);
  const fc = $("#filters-count");
  fc.hidden = !active; fc.textContent = String(active);
  fc.setAttribute("aria-label", `${active} on`);
  syncUrl();
}
