/* The mission ticket and its share and save buttons. */
"use strict";

// ---- the ticket ---------------------------------------------------------------------------------
function ticket(m, { titleId, heading = "h3" } = {}) {
  const pack = S.packById[m.pack] || { name: m.pack };
  const isKids = (m.who || []).includes("kids") && m.for_kids;

  const tags = [
    h("li", { class: "sage" }, L.mode[m.mode] || m.mode),
    h("li", {}, L.duration[m.duration] || m.duration),
    h("li", {}, L.effort[m.effort] || m.effort),
    h("li", {}, L.cost[m.cost] || m.cost),
    h("li", {}, L.setting[m.setting] || m.setting),
    m.season && m.season !== "any" ? h("li", { class: "honey" }, cap(joinList(m.season))) : null,
    L.time[m.time_of_day] ? h("li", {}, L.time[m.time_of_day]) : null,
  ];

  const notes = [];
  if (m.who && m.who.length) {
    notes.push(h("p", {}, svg(ICON.compass, 18), `Good with ${joinList(m.who.map((w) => L.who[w] || w))}`));
  }
  if (m.check_ahead && m.check_ahead.length) {
    notes.push(h("p", {}, svg(ICON.clock, 18), `Check before you go: ${checkText(m)}`));
  }
  if (m.discounts && m.discounts.length) {
    notes.push(h("p", {}, svg(ICON.tag, 18), `Ask about discounts: ${discountText(m)}`));
  }
  if (m.gear && m.gear.length) {
    const bring = m.gear.filter((g) => !g.rent || g.rent === "no").map((g) => pretty(g.item));
    const there = m.gear.filter((g) => g.rent === "on-site").map((g) => pretty(g.item));
    const near = m.gear.filter((g) => g.rent === "nearby").map((g) => pretty(g.item));
    const bits = [];
    if (bring.length) bits.push(`Bring ${joinList(bring)}`);
    if (there.length) bits.push(`${bring.length ? "rent" : "Rent"} ${joinList(there)} there`);
    if (near.length) bits.push(`${bits.length ? "rent" : "Rent"} ${joinList(near)} nearby`);
    notes.push(h("p", {}, svg(ICON.bag, 18), bits.join("; ")));
  }

  const warn = cautionText(m);
  const caution = warn ? h("div", { class: "caution", role: "note", "aria-label": "Caution" }, svg(ICON.caution, 20), h("p", {}, warn)) : null;

  let place = null;
  const c = coordsOf(m);
  if (m.place) {
    const d = distM(m);
    const links = [];
    if (c) {
      links.push(h("a", { href: `https://www.google.com/maps/search/?api=1&query=${c[0]},${c[1]}`, target: "_blank", rel: "noopener" }, svg(ICON.map, 18), "Google Maps"));
      links.push(h("a", { href: `https://maps.apple.com/?ll=${c[0]},${c[1]}&q=${encodeURIComponent(m.place.name || m.name)}`, target: "_blank", rel: "noopener" }, svg(ICON.map, 18), "Apple Maps"));
    }
    const site = safeUrl(m.place.website);
    if (site) links.push(h("a", { href: site, target: "_blank", rel: "noopener" }, svg(ICON.link, 18), "Website"));
    // optional extra links (place.links: [{label, url}]), e.g. a bike rental next to the island's own site
    for (const l of (Array.isArray(m.place.links) ? m.place.links : []).slice(0, 3)) {
      const url = safeUrl(l && l.url), label = l && String(l.label || "").trim();
      if (url && label) links.push(h("a", { href: url, target: "_blank", rel: "noopener" }, svg(ICON.link, 18), label));
    }
    place = h("div", { class: "place" },
      h("span", {}, svg(ICON.pin, 18), " ", h("b", {}, m.place.name || ""), m.place.area ? `, ${m.place.area}` : ""),
      m.place.address ? h("span", {}, m.place.address) : null,
      d != null ? h("span", { class: "dist" }, `${fmtDist(d)} from ${S.zip} as the bee flies`) : null,
      links.length ? h("div", { class: "links" }, links) : null);
  }

  const extras = [];
  if (m.steps && m.steps.length) {
    extras.push(h("details", { class: "extra" }, h("summary", {}, "Photo prompts along the way"),
      h("div", { class: "inner" }, h("ol", {}, m.steps.map((s) => h("li", {}, s))))));
  }
  if (isKids) {
    extras.push(h("details", { class: "extra" }, h("summary", {}, "Kids' version"),
      h("div", { class: "inner" }, h("p", { style: "margin:0;font-weight:800" }, m.for_kids.short),
        h("ol", {}, (m.for_kids.steps || []).map((s) => h("li", {}, s))))));
  }

  return h("article", { class: "ticket" },
    h("div", { class: "stub" }, svg(packIcon(pack), 34),
      h("span", { class: "lbl" }, "Mission"), h("span", { class: "num" }, m.number || "?")),
    h("div", { class: "body" },
      h(heading, { id: titleId || null }, m.name),
      String(m.credit || "").trim() ? h("p", { class: "credit" }, "Suggested by ", String(m.credit).trim()) : null,
      h("p", { class: "short" }, m.short),
      m.description ? h("p", { class: "desc" }, m.description) : null,
      h("ul", { class: "tags", "aria-label": "Details" }, tags),
      notes.length ? h("div", { class: "notes" }, notes) : null,
      caution, place, extras,
      h("p", { class: "source" }, svg(packIcon(pack), 18),
        h("span", {}, "Mission ", h("b", {}, String(m.number || "?")), " in ", h("b", {}, pack.name))),
      reportUrl(m) ? h("p", { class: "report" }, "Closed, moved or something off? ",
        h("a", { href: reportUrl(m), target: "_blank", rel: "noopener" }, "Report a problem")) : null));
}

function reportUrl(m) {
  if (!safeUrl(REPORT_FORM)) return null;
  const q = new URLSearchParams({ usp: "pp_url" });
  q.set(REPORT_FIELDS.id, m.full_id || m.id || "");
  q.set(REPORT_FIELDS.name, m.name || "");
  return `${REPORT_FORM}?${q}`;
}

function actions(m) {
  return h("div", { class: "ticket-actions" }, shareButtons(m), saveButton(m));
}
// two ways to share: a plain link, or a sealed "gift" link with names and a hidden note
// sharing always starts at the card, so people see the note option; "Share without a note" is at the bottom of it
function shareButtons(m) {
  return [h("button", { type: "button", class: "btn", onclick: () => openGiftForm(m, { fresh: true }) }, svg(ICON.share, 20), "Share this mission")];
}
// link box + Copy / Share… / Preview, used for both kinds of link
function linkPanel(url) {
  const box = h("input", { class: "gift-link", readonly: true, "aria-label": "Your link", value: url, onfocus: (e) => e.target.select() });
  const copy = h("button", { type: "button", class: "btn primary" }, svg(ICON.link, 20), "Copy link");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); copy.lastChild.textContent = "Copied!"; }
    catch (e) { box.focus(); box.select(); copy.lastChild.textContent = "Press copy on your keyboard"; }
  });
  const share = navigator.share ? h("button", { type: "button", class: "btn" }, svg(ICON.share, 20), "Share…") : null;
  if (share) share.addEventListener("click", async () => {
    try { await navigator.share({ title: "An AmbleBee mission", text: "You've got mail from AmbleBee. Open the envelope:", url }); } catch (e) { /* closed the sheet */ }
  });
  return { box, copy, row: h("div", { class: "gift-actions" }, copy, share,
    h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" }, "Preview")) };
}
// no names, no note: still a sealed envelope (from "a friend") with the mission inside, and the link stays unreadable
async function sharePlain(m) {
  const d = $("#gift-dialog"), body = $("#gift-body");
  const url = giftUrl(await packGift(cleanGift({ m: m.full_id })));
  const p = linkPanel(url);
  body.replaceChildren(h("div", { class: "gift-done" },
    h("p", { class: "hand gift-kicker" }, "Just the mission"),
    h("h2", { id: "gift-title" }, "Here's your link"),
    h("p", { class: "gift-lede" }, "No names and no note. They'll get a sealed envelope from \u201ca friend\u201d with this mission inside."),
    p.box, p.row,
    h("div", { class: "gift-actions small" },
      h("button", { type: "button", class: "linkish", onclick: () => openGiftForm(m) }, "Add a card after all"),
      h("button", { type: "button", class: "linkish", onclick: () => d.close() }, "Done"))));
  p.copy.focus();
}
