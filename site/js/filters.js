/* Which missions pass the current picks. */
"use strict";

// ---- filters ------------------------------------------------------------------------------------
function readFilters() {
  const checked = (name) => [...document.querySelectorAll(`[data-filter="${name}"] input:checked`)].map((i) => i.value);
  return {
    mode: (document.querySelector('input[name="mode"]:checked') || {}).value || "any",
    pack: $("#pack-select").value,
    who: checked("who"), duration: checked("duration"), effort: checked("effort"),
    cost: checked("cost"), setting: checked("setting"), time: checked("time"), themes: checked("themes"),
    inSeason: $("#f-season").checked, goNow: $("#f-gonow").checked, hour: new Date().getHours(),
    within: $("#within-select").value ? Number($("#within-select").value) : null,
  };
}
function passes(m, f) {
  if (f.mode === "date" && !["date", "both"].includes(m.mode)) return false;
  if (f.mode === "adventure" && !["adventure", "both"].includes(m.mode)) return false;
  if (f.pack !== "all" && m.pack !== f.pack) return false;
  // who's coming: kids have to be welcome if they're coming; otherwise a mission fits if it suits any of the
  // people picked (Friends + Family widens). Romantic missions are for two, so they're left out here,
  // and date-only missions have no "who" at all
  if (f.who.length) {
    const who = m.who || [];
    if ((m.themes || []).includes("romantic")) return false;
    if (f.who.includes("kids") && !who.includes("kids")) return false;
    const others = f.who.filter((w) => w !== "kids");
    if (others.length && !others.some((w) => who.includes(w))) return false;
  }
  if (f.duration.length && !f.duration.includes(m.duration)) return false;
  if (f.effort.length && !f.effort.includes(m.effort)) return false;
  if (f.cost.length && !f.cost.includes(m.cost)) return false;
  if (f.setting.length && m.setting !== "either" && !f.setting.includes(m.setting)) return false;
  if (f.time.length && m.time_of_day !== "any" && !f.time.includes(m.time_of_day)) return false;
  // themes: any of the picked ones (Food or Views), so picking more widens rather than narrows
  if (f.themes.length && !(m.themes || []).some((t) => f.themes.includes(t))) return false;
  if (f.inSeason && !inSeason(m)) return false;
  if (f.goNow && ((m.check_ahead || []).some((c) => c === "tickets" || c === "reservation")
    || !inSeason(m) || !rightTime(m, f.hour))) return false;
  if (f.within != null) { const d = distM(m); if (d != null && d > f.within * M_PER[S.unit]) return false; }
  return true;
}
function activeFilters(f) {
  return f.who.length + f.duration.length + f.effort.length + f.cost.length + f.setting.length + f.time.length + f.themes.length
    + (f.inSeason ? 1 : 0) + (f.goNow ? 1 : 0);
}
const pool = () => { const f = readFilters(); return S.missions.filter((m) => passes(m, f)); };
// at zero results: the one change that would bring the most missions back
function bestRelax(f) {
  const lists = [["who", "Who's coming"], ["duration", "How long"], ["effort", "Effort"], ["cost", "Cost"],
    ["setting", "Inside or out"], ["time", "Time of day"], ["themes", "What kind of mission"]];
  const tries = lists.filter(([k]) => f[k].length).map(([k, label]) => [label, { ...f, [k]: [] }]);
  if (f.inSeason) tries.push(["In season now", { ...f, inSeason: false }]);
  if (f.goNow) tries.push(["Go right now", { ...f, goNow: false }]);
  if (f.within != null) tries.push(["the distance", { ...f, within: null }]);
  if (f.mode !== "any") tries.push(["What are you in the mood for?", { ...f, mode: "any" }]);
  if (f.pack !== "all") tries.push(["Pick from", { ...f, pack: "all" }]);
  let best = null;
  for (const [label, g] of tries) {
    const n = S.missions.filter((m) => passes(m, g)).length;
    if (n && (!best || n > best.n)) best = { label, n };
  }
  return best;
}
function clearAll() {
  document.querySelectorAll("#filters input").forEach((i) => { i.checked = false; });
  document.querySelector('input[name="mode"][value="any"]').checked = true;
  $("#within-select").value = "";
  if (!pool().length) $("#pack-select").value = "all";
  refresh();
}
