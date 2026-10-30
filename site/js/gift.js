/* Sealed gift links and the note card. */
"use strict";

// ---- gift links ----------------------------------------------------------------------------------
// A gift link carries the mission, both names and the note in the part after "#", packed and encoded:
//   amblebee.com/#gift=1hY5BDoIwEEX3nKLp...
// Browsers never send the "#" part to a server, so GitHub and link-preview bots never see it, and the
// names and note aren't readable in the link. It is hidden, not encrypted: anyone who knows how could
// decode it. The note is only ever shown as plain text (never as HTML), because anyone can craft a link.
const b64url = {
  enc(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec(str) { let s = str.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); },
};
async function squash(bytes, Stream) {
  // read piece by piece: on a damaged link, new Response(stream) makes Firefox log an error even though it's caught
  const reader = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw")).getReader();
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Uint8Array(await new Blob(parts).arrayBuffer());
    parts.push(value);
  }
}
// format: one version character, then base64url. "1" = deflate-raw compressed JSON, "0" = plain JSON bytes.
async function packGift(g) {
  const raw = new TextEncoder().encode(JSON.stringify(g));
  let best = "0" + b64url.enc(raw);
  if (typeof CompressionStream === "function") {
    try { const z = "1" + b64url.enc(await squash(raw, CompressionStream)); if (z.length <= best.length) best = z; } catch (e) { /* plain is fine */ }
  }
  return best;
}
async function unpackGift(code) {
  try {
    const body = b64url.dec(code.slice(1));
    let bytes;
    if (code[0] === "1") {
      if (typeof DecompressionStream !== "function") return null;
      bytes = await squash(body, DecompressionStream);
    } else if (code[0] === "0") bytes = body;
    else return null;
    return cleanGift(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) { return null; }
}
// trim to limits (counting emoji as one character) and drop control characters, whatever the link says
function clip(v, max, keepLines) {
  if (typeof v !== "string") return "";
  const bad = keepLines ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return Array.from(v.replace(/\r\n?/g, "\n").replace(bad, "").trim()).slice(0, max).join("").trim();
}
function cleanGift(g) {
  if (!g || typeof g !== "object") return null;
  const th = themeOf(g.th);
  const out = { m: clip(g.m, 160), f: clip(g.f, NAME_MAX), t: clip(g.t, NAME_MAX),
    n: clip(g.n, NOTE_MAX, true).replace(/\n{3,}/g, "\n\n"), th, s: SIGNOFF[g.s] ? g.s : THEMES[th].signs[0] };
  return out.m ? out : null;
}
const giftCode = () => { const g = /(?:^#|&)gift=([A-Za-z0-9_-]+)/.exec(location.hash); return g ? g[1] : null; };
const giftUrl = (code) => `${location.origin}${HOME}#gift=${code}`;
function cardArt(theme) {
  const el = h("span", { class: "gift-bee", "aria-hidden": "true" });
  const icon = THEMES[theme].icon;
  el.innerHTML = CARD_ART[icon] || `<svg viewBox="0 0 28 26" width="34" height="32">${BEE}</svg>`;
  return el;
}

// the little florist-style card the note is written on (shown only after the envelope is opened)
function giftNote(g) {
  return h("aside", { class: `gift-note theme-${themeOf(g.th)}`, "aria-label": `A note from ${g.f || "a friend"}` },
    h("span", { class: "gift-twine", "aria-hidden": "true" }),
    h("div", { class: "gift-card-inner" },
      cardArt(themeOf(g.th)),
      g.t ? h("p", { class: "gift-to" }, `${g.t},`) : null,
      g.n ? h("p", { class: "gift-body" }, g.n) : null,
      g.s !== "none" ? h("p", { class: "gift-sign" }, SIGNOFF[g.s] || "xo,") : null,
      h("p", { class: "gift-from" }, g.f || "a friend")));
}

// the card being written lasts as long as the tab, through a closed pop-up or a refresh
function keepDraft(g) {
  S.giftDraft = g;
  try { sessionStorage.setItem("amble.giftDraft", JSON.stringify(g)); } catch (e) { /* private mode: memory is enough */ }
}
function readDraft(id) {
  let g = S.giftDraft;
  if (!g) { try { g = JSON.parse(sessionStorage.getItem("amble.giftDraft")); } catch (e) { g = null; } }
  return g && g.m === id ? g : null;
}

// "Send with a note": you write right on the card, pick who it's for, then seal it
function openGiftForm(m, opts = {}) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const pack = S.packById[m.pack] || { name: m.pack };
  // "Write back": the names swap, the theme carries over, and the reply is about the same mission
  if (opts.fresh) S.replyTo = null;
  if (opts.reply) S.replyTo = opts.reply;
  const reply = S.replyTo && S.replyTo.m === m.full_id ? S.replyTo : null;
  let draft = readDraft(m.full_id);
  if (reply && (!draft || draft.t !== reply.f)) draft = { m: m.full_id, t: reply.f, f: reply.t, n: "", th: reply.th, s: null };
  let theme = themeOf(draft ? draft.th : readPref("giftTheme"));
  const lastSign = {};   // remembers the sign-off picked for each theme while you flip between them
  if (draft && draft.s) lastSign[theme] = draft.s;

  // the editable card: every field is written in place, in the card's handwriting
  const ruler = document.createElement("canvas").getContext("2d");
  const fit = (el, ph) => {   // size a name field to its text, so the comma sits right after the name
    const cs = getComputedStyle(el);
    ruler.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    el.style.width = `${Math.ceil(ruler.measureText(el.value || ph).width) + 5}px`;
  };
  const to = h("input", { class: "gc-to", maxlength: NAME_MAX, autocomplete: "off", placeholder: "Their name", "aria-label": "To (their name)" });
  const from = h("input", { class: "gc-from", maxlength: NAME_MAX, autocomplete: "given-name", placeholder: "Your name", "aria-label": "From (your name)" });
  const note = h("textarea", { class: "gc-note", maxlength: NOTE_MAX, rows: 3, placeholder: "Write a little note… (optional, it stays hidden until they open the envelope)", "aria-label": "A little note" });
  const sign = h("select", { class: "gc-sign", "aria-label": "Sign-off" });
  to.value = draft ? draft.t : "";
  from.value = (draft && draft.f) || readPref("giftFrom") || "";
  note.value = draft ? draft.n : "";
  const grow = () => { note.style.height = "auto"; note.style.height = `${Math.max(90, note.scrollHeight)}px`; };
  [to, from].forEach((el) => el.addEventListener("input", () => fit(el, el.placeholder)));

  const art = h("span", { class: "gc-art" });
  const card = h("div", { class: "gift-note editing" },
    h("span", { class: "gift-twine", "aria-hidden": "true" }),
    h("div", { class: "gift-card-inner" }, art,
      h("p", { class: "gift-to" }, to, h("span", { "aria-hidden": "true" }, ",")),
      note,
      h("p", { class: "gift-sign" }, sign),
      h("p", { class: "gift-from" }, from)));

  const fillSigns = () => {
    const keep = signFor(theme, lastSign[theme] || (theme === themeOf(readPref("giftTheme")) ? readPref("giftSign") : null));
    sign.replaceChildren(...THEMES[theme].signs.map((k) => h("option", { value: k }, SIGNOFF[k])));
    sign.value = keep;
    sign.closest(".gift-sign").classList.toggle("is-none", keep === "none");
  };
  sign.addEventListener("change", () => { lastSign[theme] = sign.value; sign.closest(".gift-sign").classList.toggle("is-none", sign.value === "none"); });
  const setTheme = (k) => {
    theme = k;
    card.className = `gift-note editing theme-${k}`;
    art.replaceChildren(cardArt(k));
    fillSigns();
  };

  const chips = h("div", { class: "chips gift-themes", role: "radiogroup", "aria-label": "Who's it for?" },
    Object.entries(THEMES).map(([k, t]) => h("label", {},
      h("input", { type: "radio", name: "gift-theme", value: k, checked: k === theme, onchange: () => setTheme(k) }),
      h("span", {}, t.label))));

  const count = h("span", { class: "gift-count" });
  const updateCount = () => { const n = Array.from(note.value).length; count.textContent = n ? `${n} / ${NOTE_MAX}` : ""; count.classList.toggle("near", n > NOTE_MAX - 40); };
  note.addEventListener("input", () => { updateCount(); grow(); });
  const err = h("p", { class: "gift-err", role: "alert" });

  const form = h("form", { class: "gift-form", novalidate: true },
    h("p", { class: "hand gift-kicker" }, reply ? "Send one back" : "Send it sealed"),
    h("h2", { id: "gift-title" }, reply ? `Write back to ${reply.f}` : "Write them a card"),
    draft && draft.n ? h("p", { class: "gift-kept" }, "We kept what you wrote.") : null,
    h("p", { class: "gift-mission" }, svg(packIcon(pack), 18), h("span", {}, h("b", {}, m.name), ` · ${pack.name}`)),
    h("p", { class: "gift-label" }, "Who's it for?"),
    chips,
    h("div", { class: "gift-desk" }, card, count),
    h("p", { class: "gift-privacy" }, "Your note travels inside the link. It's hidden, not encrypted, so anyone with the link could read it."),
    err,
    h("div", { class: "gift-actions" },
      h("button", { type: "submit", class: "btn primary" }, svg(ICON.mail, 20), "Seal it"),
      h("button", { type: "button", class: "btn", onclick: () => sharePlain(m) }, "Share without a note"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Cancel")));

  // saved as they type, so closing the card by accident never loses it
  const saveCard = () => keepDraft({ m: m.full_id, t: to.value, f: from.value, n: note.value, th: theme, s: sign.value });
  form.addEventListener("input", saveCard);
  form.addEventListener("change", saveCard);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = cleanGift({ m: m.full_id, f: from.value, t: to.value, n: note.value, th: theme, s: sign.value });
    if (!g.t || !g.f) {
      err.textContent = !g.t ? "Who's it for? Write their name at the top of the card." : "Sign your name at the bottom so they know who it's from.";
      (!g.t ? to : from).focus(); return;
    }
    err.textContent = "";
    writePref("giftFrom", g.f); writePref("giftTheme", g.th); writePref("giftSign", g.s);
    keepDraft(g);
    sealGift(m, g, giftUrl(await packGift(g)));
  });

  setTheme(theme);
  updateCount();
  body.replaceChildren(form);
  if (!d.open) d.showModal();
  grow();
  [to, from].forEach((el) => fit(el, el.placeholder));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => [to, from].forEach((el) => fit(el, el.placeholder)));
  (to.value ? (from.value ? note : from) : to).focus();
}

// the card slides into the envelope, the flap closes, it flips to the addressed front, then the link
function sealGift(m, g, url) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const env = envelope({ title: `Sealed for ${g.t}.`, sub: g.n ? "Your note is tucked inside." : null, to: g.t, from: g.f });
  // same envelope as the one they'll open: the mission ticket goes in first, then the note card on top
  env.classList.add("sealing", "flip", "flap", "card-out", "note-out", "card-hidden", "note-hidden", "unstamped", "still");
  env.querySelector(".env-card").replaceChildren(miniTicket(m));
  const noteCard = h("div", { class: "env-notecard", "aria-hidden": "true" }, giftNote(g));
  env.querySelector(".env-card").after(noteCard);

  const { box, copy, row } = linkPanel(url);
  const done = h("div", { class: "gift-done", hidden: true },
    h("p", { class: "gift-lede" }, g.n
      ? `Send ${g.t} this link however you like. Your names are on the envelope; the note and the mission stay inside until they open it.`
      : `Send ${g.t} this link however you like. Your names are on the envelope; the mission stays a surprise until they open it.`),
    box, row,
    h("div", { class: "gift-actions small" },
      h("button", { type: "button", class: "linkish", onclick: () => openGiftForm(m) }, "Edit the card"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Done")));
  const kicker = h("p", { class: "hand gift-kicker" }, "Sealing it up…");
  const stage = h("div", { class: "gift-seal" }, kicker, h("h2", { id: "gift-title", class: "sr" }, `Sealed for ${g.t}`), h("div", { class: "seal-stage" }, env), done);
  body.replaceChildren(stage);
  body.scrollTop = 0;

  const finish = () => {
    env.classList.remove("still", "card-out", "note-out", "card-hidden", "note-hidden", "unstamped", "flap", "flip");
    stage.classList.add("sealed-up");
    kicker.textContent = "Sealed and stamped";
    done.hidden = false;
    copy.focus();
  };
  if (REDUCED()) { finish(); return; }
  fitMini(env);
  noteCard.style.setProperty("--ns", String(Math.min(1, (env.clientWidth * 0.62) / 300)));
  env.getBoundingClientRect();
  env.classList.remove("still");
  // each piece fades in, holds for a beat so you can see it's the right one, then slides in
  const PAUSE = 220;
  const steps = [
    [60, () => env.classList.remove("card-hidden")],                  // the mission ticket fades in
    [280 + PAUSE, () => env.classList.remove("card-out")],            // …and slides into the envelope
    [600, () => env.classList.remove("note-hidden")],                 // the note card fades in
    [280 + PAUSE, () => env.classList.remove("note-out")],            // …and slides in on top
    [560, () => env.classList.remove("flap")],                        // the flap folds shut
    [420, () => { env.classList.remove("unstamped"); env.classList.add("stamped"); }],   // the wax seal is pressed
    [560, () => { env.classList.remove("flip"); stage.classList.add("sealed-up"); }],    // flips over to the addressed front
    [560, finish],
  ];
  let at = 0;
  for (const [wait, fn] of steps) { at += wait; setTimeout(fn, at); }
}
