/* Filters and sorting on the cards tools/build_pages.py already put on a page: a pack page (/packs/<id>/), and with
   search (site/js/search.js) and a pack menu, Every mission (/missions/), All missions (/missions/all/) and each
   vibe page (/<collection>/). On pages with a section per pack, a section with nothing left in it hides, and on
   Every mission (data-preview) the rest of each pack only shows once something is searched, picked or filtered.
   The rules are the homepage's own: passes() from site/js/filters.js, labels from site/js/core.js. Without JavaScript
   (or before catalog.json loads) the page is just the full list, as search engines see it. */
"use strict";
(function () {
  const box = document.querySelector(".pack-filters[data-pack]");
  const grids = [...document.querySelectorAll(".pack-cards")];
  if (!box || !grids.length || typeof passes !== "function") return;
  const grid = grids[grids.length - 1];   // "nothing fits" goes after the last list
  const cards = grids.flatMap((g) => [...g.querySelectorAll("a.card")]);
  const preview = box.hasAttribute("data-preview");
  const sections = [...document.querySelectorAll(".page section.pack")].filter((sec) => sec.querySelector(".pack-cards"));
  if (cards.length < 2) return;   // nothing to sort or narrow

  const GROUPS = [
    ["who", "Who's coming", [["solo", "Just me"], ["friends", "Friends"], ["family", "Family"], ["kids", "Kids"]]],
    ["duration", "How long", [["short", "1-3 hours"], ["half-day", "Half day"], ["all-day", "All day"]]],
    ["effort", "Effort", [["easy", "Easy"], ["moderate", "Moderate"], ["hard", "Hard"]]],
    ["cost", "Cost", [["free", "Free"], ["$", "Under $20"], ["$$", "$20-60"], ["$$$", "Over $60"]]],
    ["setting", "Inside or out", [["indoor", "Indoors"], ["outdoor", "Outdoors"]]],
    ["time", "Time of day", [["morning", "Morning"], ["daytime", "Daytime"], ["evening", "Evening"], ["night", "Night"]]],
  ];
  const everything = box.dataset.pack === "all";
  const searchable = box.hasAttribute("data-search") && typeof searchScore === "function";
  const SORTS = [["pack", everything ? "By state" : "Pack order"], ["near", "Closest first"], ["far", "Farthest first"], ["new", "Newest first"], ["az", "A to Z"]];

  fetch("/catalog.json", { cache: "force-cache" }).then((r) => r.json()).then(init, () => { /* no filters, the full list stays */ });

  function init(cat) {
    const byId = {};
    (cat.missions || []).forEach((m) => { byId[m.id] = m; });
    // what search.js reads to know a mission's pack and theme names
    S.packById = Object.fromEntries((cat.packs || []).map((p) => [p.id, p]));
    S.themeLabel = Object.fromEntries((cat.themes || []).map((t) => [t.id, t.label]));
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
    // the pack menu, on pages with missions from more than one pack: Amble Anywhere first, then A to Z, with counts
    const onPage = {};
    rows.forEach((r) => { onPage[r.m.pack] = (onPage[r.m.pack] || 0) + 1; });
    const packIds = Object.keys(onPage).sort((a, b) => (b === "anywhere") - (a === "anywhere")
      || ((S.packById[a] || {}).name || a).localeCompare((S.packById[b] || {}).name || b));
    const packSel = packIds.length > 1 ? h("select", { class: "pf-sort pf-pack", "aria-label": "Show missions from" },
      h("option", { value: "all" }, `Every state (${rows.length})`),
      packIds.map((id) => h("option", { value: id }, `${(S.packById[id] || {}).name || id} (${onPage[id]})`))) : null;
    const wanted = new URLSearchParams(location.search).get("pack");   // e.g. from a link to one state
    if (packSel && onPage[wanted]) packSel.value = wanted;
    // "Distance from": a ZIP (or "City, ST"), the same lookup files as the homepage; remembered ZIPs fill it in
    const placeIn = h("input", { class: "pf-place", placeholder: "ZIP or city", autocomplete: "postal-code", "aria-label": "Distance from: ZIP code or city" });
    const placeMsg = h("p", { class: "pf-place-msg", role: "status" });
    const placeForm = h("form", { class: "pf-from", novalidate: true },
      h("label", { class: "pf-from-lbl" }, "Distance from"), placeIn, h("button", { type: "submit", class: "btn small" }, "Set"));
    const more = h("button", { type: "button", class: "btn small pf-more", "aria-expanded": "false", "aria-controls": "pf-panel" }, "Filters");
    const count = h("p", { class: "pf-count", "aria-live": "polite" });
    const doneField = h("label", { hidden: true }, h("input", { type: "checkbox", class: "pf-hidedone" }), h("span", {}, "Hide ones we've done"));
    const themeChips = h("div", { class: "chips themes", "data-pf": "themes" },
      themes.map((t) => h("label", {}, h("input", { type: "checkbox", value: t }), h("span", {}, themeLabel[t], h("small", { class: "count" })))));
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
    // All missions: a search box over the same words the old home page list searched
    const search = searchable ? h("input", { type: "search", id: "search", class: "pf-search", placeholder: "Search: waterfall, Seattle, oysters, rainy day…",
      autocomplete: "off", enterkeyhint: "search", "aria-label": everything ? "Search these missions" : "Search this pack" }) : null;
    // An empty search can offer to send its words to AmbleBee as a mission idea ("Want us to look into it?"). Only the
    // words, only when you tap it: nothing you type is sent otherwise (app/wishes.py in AmbleBee Intake).
    const askLine = h("span", { class: "pf-ask" });
    const empty = h("div", { class: "pf-empty", hidden: true },
      h("p", {}, everything ? "Nothing fits. " : "Nothing in this pack fits these filters. ",
        h("button", { type: "button", class: "linkish", onclick: () => clearAll() }, "Clear filters")), askLine);
    const asked = new Set();
    let noneTimer = null, noneCounted = "";
    function drawAsk(q) {
      if (!q) { askLine.replaceChildren(); return; }
      if (asked.has(q.toLowerCase())) { askLine.replaceChildren(h("p", { class: "pf-asked" }, "Thanks! We'll look into it.")); return; }
      const btn = h("button", { type: "button", class: "btn small" }, "Look into it");
      const msg = h("span", { role: "status" });
      btn.addEventListener("click", () => {
        btn.disabled = true;
        fetch(window.AmbleUtil.API + "/look-into", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ q }) })
          .then((r) => r.json())
          .then((b) => { if (!b.ok) throw new Error(b.error || "bad"); asked.add(q.toLowerCase()); drawAsk(q); })
          .catch(() => { btn.disabled = false; msg.textContent = " That didn't go through. Try again in a moment."; });   // a refusal too, not just the network
      });
      askLine.replaceChildren(h("p", { class: "pf-ask-q" }, `Nothing yet for “${q}”. Want us to look into it? `, btn, msg),
        h("p", { class: "pf-ask-note" }, "Only these words are sent, with nothing about you."));
    }
    // line 1: search (where there is one) with the moods beside it; line 2: Distance from, then the pack menu, sort
    // and Filters on the right
    box.replaceChildren(h("div", { class: "pf-bar" }, search ? h("div", { class: "pf-search-row", role: "search" }, search) : "", moods),
      h("div", { class: "pf-bar pf-bar2" }, placeForm, h("div", { class: "pf-right" }, packSel, sort, more)),
      placeMsg, panel, count);
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
      if (search) search.value = "";
      if (packSel) packSel.value = "all";
      moods.querySelector("input").checked = true;
      apply();
    }
    clear.addEventListener("click", clearAll);
    const newest = (m) => m.released || m.checked || "";
    // distances: S.here from core.js, so distM() and fmtDist() work as on the homepage
    const load = (url, key) => fetch("/" + url, { cache: "force-cache" }).then((r) => r.json()).then((j) => j[key]);
    let zips = null, cities = null;
    const fold = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    async function findPlace(text) {
      if (/^\d{5}$/.test(text)) {
        zips = zips || await load("zips.json", "zips");
        const c = zips[text];
        return c ? { lat: c[0], lon: c[1], label: text } : null;
      }
      cities = cities || await load("cities.json", "cities");
      const named = /^(.*?)[,\s]+([a-z]{2})$/i.exec(text);
      const st = named ? named[2].toUpperCase() : null, name = fold(named ? named[1] : text);
      const c = cities.find((x) => fold(x[0]) === name && (!st || x[1] === st)) || cities.find((x) => fold(x[0]).startsWith(name) && (!st || x[1] === st));
      return c ? { lat: c[2], lon: c[3], label: `${c[0]}, ${c[1]}` } : null;
    }
    async function setPlace(text, quiet) {
      text = String(text || "").trim();
      if (!text) { S.here = null; placeMsg.textContent = ""; distances(); return; }
      placeMsg.textContent = "Looking it up…";
      let p = null;
      try { p = await findPlace(text); } catch (e) { placeMsg.textContent = "Distance lookup isn't available right now."; return; }
      if (!p) { placeMsg.textContent = /^\d+$/.test(text) ? `Couldn't find ${text}. A ZIP code is 5 numbers, like 97201.` : `Couldn't find ${text}. Try adding the state, like Portland, OR.`; return; }
      S.here = { lat: p.lat, lon: p.lon }; S.zip = p.label;
      placeIn.value = p.label;
      placeMsg.textContent = `From ${p.label}, as the bee flies.`;
      if (!quiet && sort.value !== "far") sort.value = "near";
      distances();
    }
    placeForm.addEventListener("submit", (e) => { e.preventDefault(); setPlace(placeIn.value); });
    // each card shows how far it is once there's a place (missions you can do anywhere have no pin, so no distance)
    function distances() {
      rows.forEach((r) => {
        let tag = r.c.querySelector(".pf-dist");
        const d = S.here ? distM(r.m) : null;
        if (d == null) { if (tag) tag.remove(); return; }
        if (!tag) { tag = h("span", { class: "pf-dist" }); (r.c.querySelector(".meta") || r.c).append(tag); }
        tag.textContent = fmtDist(d);
      });
      [...sort.options].forEach((o) => { if (o.value === "near" || o.value === "far") o.disabled = !S.here; });
      if (!S.here && (sort.value === "near" || sort.value === "far")) sort.value = "pack";
      apply();
    }
    const dist = (m) => { const d = S.here ? distM(m) : null; return d == null ? null : d; };
    function apply() {
      const f = read(), n = activeFilters(f);
      doneField.hidden = !f.doneIds.size && !f.hideDone;
      let shown = 0;
      // search: every word has to match (search.js). Nothing exact? Then short word starts and small typos count
      const words = search ? searchWords(search.value) : [];
      const score = new Map();
      if (words.length) {
        rows.forEach((r) => score.set(r, searchScore(r.m, words, false)));
        if (![...score.values()].some(Boolean)) rows.forEach((r) => score.set(r, searchScore(r.m, words, true)));
      }
      const pack = packSel ? packSel.value : "all";
      // Every mission: a taste of each pack until something narrows it, then every match
      const narrowing = n > 0 || f.mode !== "any" || words.length > 0 || pack !== "all" || f.hideDone || f.inSeason;
      rows.forEach((r) => {
        r.c.hidden = !passes(r.m, f) || (words.length && !score.get(r)) || (pack !== "all" && r.m.pack !== pack)
          || (preview && !narrowing && r.c.hasAttribute("data-extra"));
        if (!r.c.hidden) shown++;
      });
      sections.forEach((sec) => { sec.hidden = !sec.querySelector(".pack-cards a.card:not([hidden])"); });
      document.querySelectorAll(".page .pack-more").forEach((a) => { a.hidden = preview && narrowing; });
      document.querySelectorAll(".page details.more-packs").forEach((d) => {
        if (narrowing) d.open = true;
        d.hidden = !d.querySelector("section.pack:not([hidden])");
      });
      // theme counts follow the other picks, like the homepage's chips
      themeChips.querySelectorAll("label").forEach((l) => {
        const t = l.querySelector("input").value, g = { ...f, themes: [t] };
        const k = rows.filter((r) => passes(r.m, g)).length;
        l.querySelector(".count").textContent = k;
        l.classList.toggle("is-empty", !k);
        l.dataset.n = k;
      });
      // like the homepage: themes you can get now first, then the dimmed ones (each A to Z, as built)
      [...themeChips.children].sort((a, b) => (+b.dataset.n > 0) - (+a.dataset.n > 0)).forEach((l) => themeChips.append(l));
      const order = rows.slice();
      if (sort.value === "near" || sort.value === "far") {
        const sign = sort.value === "near" ? 1 : -1;   // missions with no pin go last either way
        order.sort((a, b) => { const x = dist(a.m), y = dist(b.m);
          return x == null && y == null ? a.i - b.i : x == null ? 1 : y == null ? -1 : sign * (x - y) || a.i - b.i; });
      } else if (sort.value === "new") order.sort((a, b) => (newest(b.m) > newest(a.m) ? 1 : newest(b.m) < newest(a.m) ? -1 : a.i - b.i));
      else if (sort.value === "az") order.sort((a, b) => a.m.name.localeCompare(b.m.name));
      else if (words.length) order.sort((a, b) => score.get(b) - score.get(a) || a.i - b.i);   // best matches first
      else order.sort((a, b) => a.i - b.i);
      order.forEach((r) => r.c.parentElement.append(r.c));   // each card stays in its own pack's list
      more.replaceChildren("Filters", n ? h("span", { class: "pf-n" }, String(n)) : "");
      const all = preview ? rows.filter((r) => !r.c.hasAttribute("data-extra")).length : rows.length;
      count.textContent = !narrowing && shown === all ? "" : words.length ? `${shown} ${shown === 1 ? "mission matches" : "missions match"} "${search.value.trim()}"`
        : `Showing ${shown} of ${rows.length}`;
      empty.hidden = shown > 0;
      // a search that found nothing: offer to look into it, and count it (the count has no words in it)
      const q = search && words.length && shown === 0 && !n ? search.value.trim().slice(0, 80) : "";
      drawAsk(q);
      clearTimeout(noneTimer);
      if (q && q.toLowerCase() !== noneCounted) noneTimer = setTimeout(() => {
        noneCounted = q.toLowerCase();
        if (window.ambleTrack) window.ambleTrack("search_none", {});
      }, 1500);
    }
    box.addEventListener("change", (e) => { if (e.target !== placeIn && e.target !== search) apply(); });
    if (search) {
      let timer = null;
      search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 120); });
      search.addEventListener("keydown", (e) => { if (e.key === "Escape") { search.value = ""; apply(); } });
      const q = new URLSearchParams(location.search).get("q");   // an old home page search link lands here
      if (q) search.value = q.slice(0, 80);
      if (location.hash === "#search" || q) search.focus();
    }
    window.addEventListener("amble:done", apply);
    distances();
    const remembered = readPref("zip");   // the ZIP you chose to remember on the homepage
    if (remembered) setPlace(remembered, true);
  }
})();
