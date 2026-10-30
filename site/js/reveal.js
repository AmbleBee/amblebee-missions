/* The envelope, the reveal view and the page routing. */
"use strict";

// ---- home teaser + the reveal view ---------------------------------------------------------------
const revealing = () => document.body.classList.contains("revealing");
// ---- the sealed letter: flips over, the flap lifts, the mission card slides out ------------------
const REDUCED = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const LOST = {
  gone: "That mission isn't available right now. Open one of your own?",
  cut: "The link may have been cut off when it was copied. Ask them to send it again, or open your own.",
};
const BEE = '<path d="M6 21 h14" stroke="#7A5A42" stroke-width="2" stroke-linecap="round"/><path d="M8 21 C8 15 9 11 13 7 C17 11 18 15 18 21z" fill="#D8A65A"/><path d="M9.5 17 h7 M9 19 h8 M10.5 14.5 h5" stroke="#B5853F" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 21 v-2 a1.5 1.5 0 0 1 3 0 v2z" fill="#5A3E2B"/><ellipse cx="20" cy="6" rx="2.6" ry="1.8" fill="#FFFDF8" stroke="#7A5A42" stroke-width=".9" transform="rotate(-25 20 6)"/><ellipse cx="21.3" cy="9" rx="3.4" ry="2.5" fill="#E8B54A"/><path d="M20.6 6.8 v4.4 M22.4 7 v4" stroke="#5A3E2B" stroke-width="1"/><circle cx="24.4" cy="8.7" r="1.5" fill="#5A3E2B"/>';
function envelope({ title, sub, from, to, button, onOpen, card }) {
  const stamp = h("span", { class: "env-stamp", "aria-hidden": "true" });
  stamp.innerHTML = `<svg viewBox="0 0 28 26" width="46" height="43">${BEE}</svg><b>AmbleBee</b>`;
  const mark = h("span", { class: "env-postmark", "aria-hidden": "true" }, h("span", {}, "Hive"), h("span", {}, "Post"));
  const front = h("div", { class: "env-face env-front" }, stamp, mark,
    h("p", { class: "env-addr" }, h("span", {}, `To: ${to || "you"}`), h("span", {}, `From: ${from || "AmbleBee"}`)),
    h("p", { class: "hand env-title" }, title),
    sub ? h("p", { class: "env-sub" }, sub) : null,
    button ? h("button", { type: "button", class: "btn primary env-open", onclick: (e) => { e.stopPropagation(); onOpen(); } }, button) : null);
  const inner = h("div", { class: "env-card" }, card ? miniTicket(card) : null);
  const back = h("div", { class: "env-face env-back", "aria-hidden": "true" },
    inner, h("div", { class: "env-pocket" }), h("div", { class: "env-flap" }, h("span", { class: "env-seal" })));
  return h("div", { class: "env" }, h("div", { class: "env-body" }, front, back));
}
// The real ticket, laid out at its final width and shrunk to fit inside the envelope,
// so the card that slides out is the same ticket that then grows to full size.
const ticketWidth = () => Math.min(860, document.documentElement.clientWidth - (window.innerWidth <= 560 ? 32 : 40));
function miniTicket(m) {
  const w = h("div", { class: "env-ticket" }, ticket(m));
  w.style.width = `${ticketWidth()}px`;
  w.inert = true;
  return w;
}
function fitMini(env) {
  const card = env.querySelector(".env-card"), mini = card && card.firstChild;
  if (mini) mini.style.transform = `scale(${card.clientWidth / ticketWidth()})`;
}
// play the open animation, then call done(). A tap during the animation skips to the end.
function playOpen(env, done) {
  if (env.dataset.playing) return;
  env.dataset.playing = "1";
  let finished = false;
  const timers = [];
  const finish = () => { if (finished) return; finished = true; timers.forEach(clearTimeout); env.removeEventListener("click", finish); done(); };
  if (REDUCED()) { env.classList.add("fade"); timers.push(setTimeout(finish, 180)); return; }
  env.addEventListener("click", finish);
  env.classList.add("flip");
  timers.push(setTimeout(() => env.classList.add("flap"), 520));
  timers.push(setTimeout(() => env.classList.add("card-out"), 860));
  timers.push(setTimeout(finish, 1500));
}
function pickMission() {
  const p = pool();
  if (!p.length) return null;
  const choices = p.length > 1 && S.current ? p.filter((m) => m.full_id !== S.current.full_id) : p;
  const pick = (from) => from[Math.floor(Math.random() * from.length)];
  if (!S.here) return pick(choices);
  // with a ZIP set, most picks are real places nearby; the rest are do-anywhere ideas
  const f = readFilters();
  const reach = f.within != null ? f.within * M_PER[S.unit] : NEARBY_M;
  const near = choices.filter((m) => { const d = distM(m); return d != null && d <= reach; });
  const rest = choices.filter((m) => !near.includes(m));
  return pick(near.length && (!rest.length || Math.random() < NEARBY_SHARE) ? near : rest);
}
function renderTeaser() {
  const n = pool().length;
  const f = readFilters();
  const to = f.mode === "date" ? "the two of you" : f.mode === "adventure" ? "whoever's coming" : "you";
  if (!n) {
    const best = bestRelax(f);
    const env = envelope({ title: "Nothing matches, yet.", to, button: "Clear all", onOpen: clearAll,
      sub: best ? `Changing "${best.label}" would open up ${best.n} ${best.n === 1 ? "mission" : "missions"}.` : "Try clearing your filters." });
    env.classList.add("nothing");
    $("#ticket-slot").replaceChildren(env);
    return;
  }
  const env = envelope({ title: "Your next mission is sealed inside.", to,
    sub: `${n} ${n === 1 ? "mission fits" : "missions fit"} what you picked.`,
    button: "Open", onOpen: () => openFromHome() });
  $("#ticket-slot").replaceChildren(env);
}
function openFromHome() {
  const env = $("#ticket-slot .env");
  const m = pickMission();
  if (!env || !m) return;
  const card = env.querySelector(".env-card");
  card.replaceChildren(miniTicket(m));
  fitMini(env);
  const r = env.getBoundingClientRect();
  const offscreen = r.top < 0 || r.bottom > window.innerHeight;
  if (offscreen && !REDUCED()) env.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => playOpen(env, () => goReveal(m, { growFrom: card.getBoundingClientRect() })), offscreen && !REDUCED() ? 380 : 0);
}
function goReveal(m, { replace = false, growFrom = null } = {}) {
  S.rolledId = m.full_id;
  const url = `#mission=${encodeURIComponent(m.full_id)}`;
  // "rolled" stays with this history entry, so a refresh still knows this mission is yours, not a shared one
  if (replace || revealing()) history.replaceState({ ...history.state, rolled: m.full_id }, "", url);
  else history.pushState({ amble: "reveal", rolled: m.full_id }, "", url);
  showReveal(m, { from: "roll", growFrom });
}
function rollSummary() {
  // e.g. "Picked for you from 46 missions in Amble Anywhere", "A date, picked from 31 missions within 30 mi of 97201"
  const f = readFilters();
  const p = pool().length;
  const lead = f.mode === "date" ? "A date, picked" : f.mode === "adventure" ? "An adventure, picked" : "Picked for you";
  let line = `${lead} from ${p} ${p === 1 ? "mission" : "missions"}`;
  if (f.pack !== "all") line += ` in ${(S.packById[f.pack] || {}).name || f.pack}`;
  if (S.here && f.within != null) line += ` within ${f.within} ${S.unit} of ${S.zip}`;
  else if (S.here) line += ` near ${S.zip}`;
  const n = activeFilters(f);
  if (n) line += ` with ${n} ${n === 1 ? "filter" : "filters"}`;
  return line;
}
function showReveal(m, { from = "roll", sealed = false, animate = false, growFrom = null } = {}) {
  S.current = m; S.revealFrom = from;
  document.body.classList.add("revealing");
  $("#reveal").hidden = false;
  const gift = from === "gift" ? S.gift : null;
  const linked = from === "link" || !!gift;
  $("#reveal-kicker").textContent = gift ? `A mission from ${gift.f || "a friend"}` : linked ? "A mission, shared with you" : "Your mission";
  $("#reveal-summary").textContent = gift ? `Sealed just for ${gift.t || "you"}. Open your own any time.`
    : linked ? "Someone sent you this one. Open your own any time." : rollSummary();
  $("#reveal-summary").hidden = sealed || from === "mine";   // "mine": reopened, so the old picks are gone
  window.scrollTo({ top: 0 });
  const slot = $("#reveal-slot");
  if (sealed || animate) {
    document.title = `A sealed mission · ${SITE_NAME}`;
    $("#reveal-actions").replaceChildren(); $("#reveal-adjust").hidden = true;
    const env = envelope({
      title: gift ? `${gift.f || "Someone"} sent you a mission.` : sealed ? "Someone sent you a mission." : "Your next mission is sealed inside.",
      sub: gift && gift.n ? "There's a note tucked inside." : null,
      to: gift ? gift.t || "you" : "you", from: gift ? gift.f || "a friend" : sealed ? "a friend" : "AmbleBee", card: m,
      button: sealed ? "Open" : null, onOpen: () => open() });
    const open = () => playOpen(env, () => showReveal(m, { from, growFrom: env.querySelector(".env-card").getBoundingClientRect() }));
    env.classList.add("in-reveal");
    slot.replaceChildren(env);
    fitMini(env);
    if (animate) setTimeout(open, REDUCED() ? 0 : 260);
    return;
  }
  document.title = `${m.name} · ${SITE_NAME}`;
  const t = ticket(m, { titleId: "reveal-title", heading: "h1" });
  slot.replaceChildren(...(gift && gift.n ? [giftNote(gift), t] : [t]));
  const replyTo = gift && gift.f ? gift : null;
  $("#reveal-actions").replaceChildren(...[   // replaceChildren would print a null as the word "null", so drop it
    replyTo ? h("button", { type: "button", class: "btn primary", onclick: () => openGiftForm(m, { reply: replyTo }) }, svg(ICON.mail, 22), `Write back to ${replyTo.f}`) : null,
    h("button", { type: "button", class: replyTo ? "btn" : "btn primary", onclick: roll }, replyTo ? null : svg(ICON.mail, 22), linked ? "Open your own" : "Open another"),
    ...shareButtons(m),
    saveButton(m, gift),
    h("button", { type: "button", class: "btn", onclick: () => startOver() }, "Start over"),
  ].filter(Boolean));
  $("#reveal-adjust").hidden = linked;
  if (growFrom && growFrom.width && !REDUCED()) growTicket(t, growFrom); else t.classList.add("pop");
  const title = $("#reveal-title"); if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
}
// FLIP: start the full ticket at the envelope card's spot and size, then let it grow into place.
function growTicket(t, from) {
  const to = t.getBoundingClientRect();
  if (!to.width) { t.classList.add("pop"); return; }
  const s = from.width / to.width;
  const cut = Math.max(0, to.height - from.height / s);
  const rest = [$("#reveal-actions"), $("#reveal-adjust"), $(".reveal-head")];
  rest.forEach((e) => e && e.classList.add("grow-wait"));
  t.style.transformOrigin = "0 0";
  t.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`;
  t.style.clipPath = `inset(0 0 ${cut}px 0 round 24px)`;
  t.getBoundingClientRect();
  requestAnimationFrame(() => {
    t.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1), clip-path .6s cubic-bezier(.2,.8,.2,1)";
    t.style.transform = "";
    t.style.clipPath = "inset(0 0 0 0 round 24px)";
    setTimeout(() => {
      t.style.transition = ""; t.style.clipPath = ""; t.style.transformOrigin = "";
      rest.forEach((e) => e && e.classList.remove("grow-wait"));
    }, 640);
  });
}
function showHome() {
  document.body.classList.remove("revealing");
  $("#reveal").hidden = true;
  S.current = null;
  document.title = SITE_NAME;
  renderTeaser();
}
// a link that can't be delivered: says so in the reveal view, where it can't be missed on a phone
function showLost(sub) {
  S.current = null;
  document.title = `Lost in the mail · ${SITE_NAME}`;
  document.body.classList.add("revealing");
  $("#reveal").hidden = false;
  $("#reveal-kicker").textContent = "Return to sender";
  $("#reveal-summary").hidden = true;
  $("#reveal-actions").replaceChildren(); $("#reveal-adjust").hidden = true;
  const env = envelope({ title: "This letter got lost in the mail.", sub, to: "you", button: "Open your own",
    onOpen: () => {
      history.replaceState(null, "", location.pathname + location.search);
      S.shownGift = null; S.shownLost = null; S.giftKey = null; S.giftP = Promise.resolve(null);
      showHome(); openFromHome();
    } });
  env.classList.add("in-reveal");
  $("#reveal-slot").replaceChildren(env);
  window.scrollTo({ top: 0 });
}
// Back from the reveal goes home. A reveal opened from the home page pushes one history entry;
// re-rolls replace it, so Back always lands on the home page.
function startOver({ filters = false, then = null } = {}) {
  S.afterHome = filters ? "filters" : then;   // then: {id, search} = scroll to a section once home is showing
  if (history.state && history.state.amble === "reveal") { history.back(); return; }
  history.replaceState(null, "", location.pathname + location.search);
  route();
}
async function route() {
  // gift links: decode (async), show the sealed envelope once per link, then the ticket + note
  const code = giftCode();
  if (code !== S.giftKey) { S.giftKey = code; S.giftP = code ? unpackGift(code) : Promise.resolve(null); }
  const gift = await S.giftP;
  if (code !== giftCode()) return;   // the link changed while we were decoding
  S.gift = gift;
  if (code) {
    const gm = gift && S.missions.find((x) => x.full_id === gift.m);
    if (gm) {
      if (S.shownGift !== code) { S.shownGift = code; showReveal(gm, { from: "gift", sealed: true }); }
    } else if (S.shownGift !== code) {
      S.shownGift = code;
      showLost(gift ? LOST.gone : LOST.cut);
    }
    S.booted = true; return;
  }
  S.shownGift = null;
  const m = fromHash();
  if (m) {
    if (!revealing() || m !== S.current) {
      // your own pick after a refresh, or arriving from the mission's own page: no envelope from "a friend"
      const mine = (history.state && history.state.rolled === m.full_id) || /(?:^#|&)from=page(?:&|$)/.test(location.hash);
      const from = S.rolledId === m.full_id ? "roll" : mine ? "mine" : "link";
      showReveal(m, { from, sealed: from === "link" && !S.booted });
    }
    S.booted = true; return;
  }
  const wanted = hashMission();
  if (wanted != null) {
    if (S.shownLost !== location.hash) { S.shownLost = location.hash; showLost(wanted ? LOST.gone : LOST.cut); }
    S.booted = true; return;
  }
  S.shownLost = null;
  S.booted = true;
  if (revealing() || !$("#ticket-slot").firstChild) showHome();
  const after = S.afterHome; S.afterHome = null;
  if (after === "filters") {
    $("#filters").hidden = true; $("#filters-toggle").click();
  } else if (after === "top") {
    window.scrollTo({ top: 0 });
  } else if (after && after.id) {
    const el = document.getElementById(after.id);
    requestAnimationFrame(() => {
      if (el) el.scrollIntoView({ behavior: REDUCED() ? "auto" : "smooth" });
      if (after.search) $("#search-input").focus({ preventScroll: true });
    });
  }
}
function roll() {
  if (!revealing()) { if (!pool().length) { startOver(); return; } openFromHome(); return; }
  const m = pickMission();
  if (!m) { startOver(); return; }
  S.rolledId = m.full_id;
  history.replaceState({ ...history.state, rolled: m.full_id }, "", `#mission=${encodeURIComponent(m.full_id)}`);
  showReveal(m, { from: "roll", animate: true });
}
function openDialog(m) {
  const body = $("#dialog-body");
  body.replaceChildren(ticket(m, { titleId: "dialog-title", heading: "h2" }), actions(m));
  // the pop-up has the mission page's address, so a refresh or copied link lands on the real page
  history.pushState({ amble: "popup" }, "", `${HOME}missions/${m.id}/`);
  $("#mission-dialog").showModal();
}
