/* Mission search, used by the All missions page (/missions/all/, site/js/packfilter.js).
   Needs core.js (S, L, fold) first. */
"use strict";

// search: every word must match a whole word in the mission, so "sea" doesn't find "season".
// Longer words also match word starts ("waterfal"); matches in the name rank highest.
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
function searchWords(text = S.q) {
  const all = tokens(text);
  const useful = all.filter((w) => !STOP_WORDS.has(w));
  return useful.length ? useful : all;
}
