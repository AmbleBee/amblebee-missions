/* Filters and sorting on a pack page (/packs/<id>/), on the cards tools/build_pages.py already put there.
   The rules are the homepage's own: passes() from site/js/filters.js, labels from site/js/core.js. Without JavaScript
   (or before catalog.json loads) the page is just the full list, as search engines see it. */
"use strict";
(function () {
  const box = document.querySelector(".pack-filters[data-pack]");
  const grid = document.querySelector(".pack-cards");
  if (!box || !grid || typeof passes !== "function") return;
  const cards = [...grid.querySelectorAll("a.card")];
  if (cards.length < 2) return;   // nothing to sort or narrow

  const GROUPS = [
    ["who", "Who's coming", [["solo", "Just me"], ["friends", "Friends"], ["family", "Family"], ["kids", "Kids"]]],
    ["duration", "How long", [["short", "1-3 hours"], ["half-day", "Half day"], ["all-day", "All day"]]],
    ["effort", "Effort", [["easy", "Easy"], ["moderate", "Moderate"], ["hard", "Hard"]]],
    ["cost", "Cost", [["free", "Free"], ["$", "Under $20"], ["$$", "$20-60"], ["$$$", "Over $60"]]],
    ["setting", "Inside or out", [["indoor", "Indoors"], ["outdoor", "Outdoors"]]],
    ["time", "Time of day", [["morning", "Morning"], ["daytime", "Daytime"], ["evening", "Evening"], ["night", "Night"]]],
  ];
  const SORTS = [["pack", "Pack order"], ["new", "Newest first"], ["az", "A to Z"]];

  fetch("/catalog.json", { cache: "force-cache" }).then((r) => r.json()).then(init, () => { /* no filters, the full list stays */ });

  function init(cat) {
    const byId = {};
    (cat.missions || []).forEach((m) => { byId[m.id] = m; });
    const rows = cards.map((c, i) => {
      const id = (/\/missions\/([^/]+)\//.exec(c.getAttribute("href") || "") || [])[1];
      return { c, m: byId[id], i };
    }).filter((r) => r.m);
    if (rows.length < 2) return;
    const themeLabel = {};
    (cat.themes || []).forEach((t) => { themeLabel[t.id] = t.label; });
    const themes = [...new Set(rows.flatMap((r) => r.m.themes || []))].filter((t) => themeLabel[t])
      .sort((a, b) => themeLabel[a].localeCompare(themeLabel[b]));

    const chip = (name, value, label, type = "checkbox") =>
      h("label", {}, h("input", { type, name, value }), h("span", {}, label));
    const moods = h("div", { class: "modes pf-modes", role: "radiogroup", "aria-label": "In the mood for" },
      chip("pf-mode", "any", "Anything", "radio"), chip("pf-mode", "date", "A date", "radio"), chip("pf-mode", "adventure", "An adventure", "radio"));
    moods.querySelector("input").checked = true;
    const sort = h("select", { class: "pf-sort", "aria-label": "Sort" }, SORTS.map(([v, l]) => h("option", { value: v }, l)));
    const more = h("button", { type: "button", class: "btn small pf-more", "aria-expanded": "false", "aria-controls": "pf-panel" }, "Filters");
    const count = h("p", { class: "pf-count", "aria-live": "polite" });
    const doneField = h("label", { hidden: true }, h("input", { type: "checkbox", class: "pf-hidedone" }), h("span", {}, "Hide ones we've done"));
    const themeChips = h("div", { class: "chips themes", "data-pf": "themes" },
      themes.map((t) => h("label", {}, h("input", { type: "checkbox", value: t }), h("span", {}, themeLabel[t], " ", h("span", { class: "count" })))));
    const clear = h("button", { type: "button", class: "linkish" }, "Clear filters");
    const panel = h("div", { class: "filters pf-panel", id: "pf-panel", hidden: true },
      h("div", { class: "filter-grid" },
        GROUPS.map(([key, legend, opts]) => h("fieldset", {}, h("legend", {}, legend),
          h("div", { class: "chips", "data-pf": key }, opts.map(([v, l]) => chip("pf-" + key, v, l))))),
        h("fieldset", {}, h("legend", {}, "Right now"),
          h("div", { class: "chips" }, h("label", {}, h("input", { type: "checkbox", class: "pf-season" }), h("span", {}, "In season now")), doneField)),
        themes.length > 1 ? h("fieldset", { class: "pf-themes" }, h("legend", {}, "What kind of mission"), themeChips) : null),
      h("div", { class: "filters-bar" }, clear,
        h("button", { type: "button", class: "btn primary small", onclick: () => toggle(false) }, "Done")));
    const empty = h("p", { class: "pf-empty", hidden: true }, "Nothing in this pack fits these filters. ",
      h("button", { type: "button", class: "linkish", onclick: () => clearAll() }, "Clear filters"));
    box.replaceChildren(h("div", { class: "pf-bar" }, moods, h("div", { class: "pf-right" }, sort, more)), panel, count);
    grid.after(empty);

    function toggle(on) {
      panel.hidden = !on;
      more.setAttribute("aria-expanded", String(on));
      if (!on) more.focus({ preventScroll: true });
    }
    more.addEventListener("click", () => toggle(panel.hidden));
    const picked = (key) => [...box.querySelectorAll(`[data-pf="${key}"] input:checked`)].map((i) => i.value);
    function read() {
      return { mode: (box.querySelector('input[name="pf-mode"]:checked') || {}).value || "any", pack: "all",
        who: picked("who"), duration: picked("duration"), effort: picked("effort"), cost: picked("cost"),
        setting: picked("setting"), time: picked("time"), themes: picked("themes"),
        inSeason: box.querySelector(".pf-season").checked, goNow: false, hour: new Date().getHours(), within: null,
        hideDone: box.querySelector(".pf-hidedone").checked, doneIds: doneIds() };
    }
    function clearAll() {
      box.querySelectorAll(".pf-panel input").forEach((i) => { i.checked = false; });
      moods.querySelector("input").checked = true;
      apply();
    }
    clear.addEventListener("click", clearAll);
    const newest = (m) => m.released || m.checked || "";
    function apply() {
      const f = read(), n = activeFilters(f);
      doneField.hidden = !f.doneIds.size && !f.hideDone;
      let shown = 0;
      rows.forEach((r) => { r.c.hidden = !passes(r.m, f); if (!r.c.hidden) shown++; });
      // theme counts follow the other picks, like the homepage's chips
      themeChips.querySelectorAll("label").forEach((l) => {
        const t = l.querySelector("input").value, g = { ...f, themes: [t] };
        const k = rows.filter((r) => passes(r.m, g)).length;
        l.querySelector(".count").textContent = k;
        l.classList.toggle("is-empty", !k);
      });
      const order = rows.slice();
      if (sort.value === "new") order.sort((a, b) => (newest(b.m) > newest(a.m) ? 1 : newest(b.m) < newest(a.m) ? -1 : a.i - b.i));
      else if (sort.value === "az") order.sort((a, b) => a.m.name.localeCompare(b.m.name));
      else order.sort((a, b) => a.i - b.i);
      order.forEach((r) => grid.append(r.c));
      more.replaceChildren("Filters", n ? h("span", { class: "pf-n" }, String(n)) : "");
      count.textContent = shown === rows.length ? "" : `Showing ${shown} of ${rows.length}`;
      empty.hidden = shown > 0;
    }
    box.addEventListener("change", apply);
    window.addEventListener("amble:done", apply);
    apply();
  }
})();
