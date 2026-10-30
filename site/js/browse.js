/* The Every mission list and search. */
"use strict";

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
// "Sort by" in Every mission: a flat list instead of pack sections. Ties stay in A to Z order.
const byRank = (order, get) => (a, b) => order.indexOf(get(a)) - order.indexOf(get(b)) || a.name.localeCompare(b.name);
const SORTS = {
  distance: (a, b) => (distM(a) ?? Infinity) - (distM(b) ?? Infinity) || a.name.localeCompare(b.name),
  cost: byRank(["free", "$", "$$", "$$$"], (m) => m.cost),
  duration: byRank(["short", "half-day", "all-day"], (m) => m.duration),
};
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
    : h("span", {}, h("b", {}, String(n)), ` ${word(n)} ${active ? "with these filters" : "to pick from"}`));
  $("#match-clear").hidden = n > 0;
  if (S.booted) announce(mc.textContent);
  const fc = $("#filters-count");
  fc.hidden = !active; fc.textContent = String(active);
  fc.setAttribute("aria-label", `${active} on`);
  // "Every mission" follows every pick except "Pick from", because the list has its own pack menu
  const everything = S.missions.filter((m) => passes(m, { ...f, pack: "all" }));
  const browsing = narrowed || f.mode !== "any";
  $("#browse-count").textContent = browsing ? `${everything.length} of ${total} live missions fit your filters` : liveLine();
  $("#browse-clear").hidden = !browsing;

  renderBrowsePick(everything);
  syncUrl();
  const wrap = $("#packs");
  wrap.replaceChildren();
  const words = searchWords();
  const searching = words.length > 0;
  $("#browse-share").hidden = !(browsing || searching || S.sort || !["all", "near"].includes(S.browse));
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
    // a real link, so open-in-new-tab and copy link work; a plain click opens the pop-up instead
    return h("a", { class: "card", href: `${HOME}missions/${m.id}/`, onclick: (e) => {
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      openDialog(m);
    } },
      h("span", { class: "card-top" },
        h("span", { class: "no" }, (S.browse === "near" || searching || S.sort) && pack ? `${pack.name} · Mission ${m.number}`
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
    if (S.sort) found = [...found].sort(SORTS[S.sort]);
    $("#browse-count").textContent = close && found.length
      ? `${found.length} close ${found.length === 1 ? "match" : "matches"} for "${S.q.trim()}"`
      : `${found.length} ${found.length === 1 ? "mission matches" : "missions match"} "${S.q.trim()}"`;
    announce($("#browse-count").textContent);
    if (found.length) wrap.append(h("section", { class: "pack", "aria-label": "Search results" },
      h("div", { class: "cards" }, found.map(card))));
    else wrap.append(h("p", { class: "none" },
      browsing ? `Nothing matches "${S.q.trim()}" with these filters. Try clearing them.`
        : `Nothing matches "${S.q.trim()}". Try a different word, like a town, a place or an activity.`));
    return;
  }
  if (S.browse === "near" && S.here) {
    const near = everything.filter((m) => distM(m) != null).sort((x, y) => distM(x) - distM(y)).slice(0, NEAR_MAX);
    if (S.sort) near.sort(SORTS[S.sort]);
    if (near.length) wrap.append(h("section", { class: "pack", "aria-label": "Closest to your ZIP" },
      h("div", { class: "pack-head" },
        h("span", { class: "badge" }, svg(ICON.pin, 26)),
        h("div", {}, h("h3", {}, `Closest to ${S.zip}`),
          h("p", {}, `${near.length === 1 ? "The nearest place" : `The ${near.length} nearest places`}, as the bee flies. Amble Anywhere missions work from anywhere.`))),
      h("div", { class: "cards" }, near.map(card))));
  } else if (S.sort) {
    const ms = everything.filter((m) => S.browse === "all" || m.pack === S.browse).sort(SORTS[S.sort]);
    if (ms.length) wrap.append(h("section", { class: "pack", "aria-label": "Sorted missions" }, h("div", { class: "cards" }, ms.map(card))));
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
  if (S.sort === "distance" && !S.here) S.sort = "";
  const sorts = [["", "Pack"], ...(S.here ? [["distance", "Closest first"]] : []), ["cost", "Lowest cost first"], ["duration", "Shortest first"]];
  $("#browse-sort").replaceChildren(...sorts.map(([v, label]) => h("option", { value: v }, label)));
  $("#browse-sort").value = S.sort;
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
