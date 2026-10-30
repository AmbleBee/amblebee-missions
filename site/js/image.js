/* Saving a mission as an image. */
"use strict";

// ---- save a mission as an image (for the camera roll) ----------------------------------------------
// Drawn on a canvas right here in the browser: nothing is uploaded. Text is drawn as text, never parsed.
function saveButton(m, gift) {
  const b = h("button", { type: "button", class: "btn", onclick: () => saveMissionImage(m, gift, b) }, svg(ICON.download, 20), "Save as image");
  return b;
}
const IMG = { w: 1080, pad: 64, minH: 1350 };
const IMGC = {   // always the light palette, so saved images look the same everywhere
  oat: "#EFE7D8", paper: "#FFFDF8", linen: "#FAF5EC", line: "#E4D9C6", lineStrong: "#D9CDB6", sand: "#F1E5D2",
  sage: "#A3B18A", sageDeep: "#566B48", sageTint: "#E3EAD6", sageInk: "#3F5235", honey: "#D8A65A", honeyTint: "#F6E6C6", honeyDeep: "#946628",
  walnut: "#5A3E2B", walnutSoft: "#7A5A42", ink: "#4A3323",
};
const IMGT = {   // note-card colours per theme: frame, dashed border, names
  partner: { frame: "#F6DDD6", dash: "#E2A699", accent: "#A9544A" },
  friend: { frame: "#E3EAD6", dash: "#A3B18A", accent: "#566B48" },
  family: { frame: "#F6E6C6", dash: "#D8A65A", accent: "#946628" },
};
const IMGF = {
  display: (w, px) => `${w} ${px}px "Fraunces Variable", "Fraunces", Georgia, serif`,
  body: (w, px) => `${w} ${px}px "Nunito Variable", "Nunito", "Segoe UI", system-ui, sans-serif`,
  hand: (px) => `700 ${px}px "Caveat", "Segoe Print", "Bradley Hand", cursive`,
};
function svgImage(markup, { size = 24, stroke = IMGC.walnut, viewBox = "0 0 24 24", fill = "none" } = {}) {
  const src = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}" fill="${fill}" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src); });
}
function rrect(ctx, x, y, w, hh, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// split text into lines that fit `width`; the last allowed line gets an ellipsis if it runs over
function wrapLines(ctx, text, width, maxLines = 99) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= width || !line) line = test; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const keep = out.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > width) last = last.replace(/\s*\S+$/, "");
    keep[maxLines - 1] = (last || "") + "…";
    return keep;
  }
  return out;
}
async function drawMission(m, gift) {
  const pack = S.packById[m.pack] || { name: m.pack };
  const c = coordsOf(m);
  const warn = cautionText(m);
  const [packImg, pinImg, clockImg, beeImg, tagImg, cautionImg] = await Promise.all([
    svgImage(packIcon(pack), { size: 64, stroke: "#FFFDF8" }),
    svgImage(ICON.pin, { size: 40, stroke: IMGC.sageDeep }),
    svgImage(ICON.clock, { size: 36, stroke: IMGC.walnutSoft }),
    svgImage(BEE, { size: 84, viewBox: "0 0 28 26", stroke: "none", fill: "none" }),
    svgImage(ICON.tag, { size: 36, stroke: IMGC.walnutSoft }),
    warn ? svgImage(ICON.caution, { size: 38, stroke: IMGC.honeyDeep }) : null,
  ]);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const W = IMG.w, P = IMG.pad, cardX = P, cardW = W - P * 2, inX = cardX + 52, inW = cardW - 104;

  // one pass to measure, one pass to draw
  const paint = (draw) => {
    let y = P;
    // header: hive + name
    if (draw && beeImg) ctx.drawImage(beeImg, P - 4, y - 6, 84, 78);
    if (draw) { ctx.font = IMGF.display(600, 44); ctx.fillStyle = IMGC.ink; ctx.textBaseline = "middle"; ctx.fillText("AmbleBee", P + 92, y + 36);
      const wA = ctx.measureText("AmbleBee ").width; ctx.fillStyle = IMGC.sageDeep; ctx.fillText("Missions", P + 92 + wA, y + 36); }
    y += 72 + 34;

    // optional note from a gift, as a little card
    if (gift && gift.n) {
      ctx.font = IMGF.hand(44);
      const noteLines = wrapLines(ctx, gift.n, cardW - 120, 6);
      const signLine = gift.s !== "none" ? (SIGNOFF[gift.s] || "") : "";
      const nh = 40 + (gift.t ? 52 : 0) + noteLines.length * 52 + (signLine ? 52 : 0) + 52 + 14;
      const tc = IMGT[themeOf(gift.th)];
      if (draw) {
        ctx.save(); ctx.translate(W / 2, y + nh / 2); ctx.rotate(-1.2 * Math.PI / 180); ctx.translate(-W / 2, -(y + nh / 2));
        ctx.shadowColor = "rgba(90,62,43,.18)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
        rrect(ctx, cardX + 20, y, cardW - 40, nh, 14); ctx.fillStyle = tc.frame; ctx.fill();
        ctx.shadowColor = "transparent";
        rrect(ctx, cardX + 30, y + 10, cardW - 60, nh - 20, 8); ctx.fillStyle = IMGC.paper; ctx.fill();
        ctx.setLineDash([8, 7]); ctx.strokeStyle = tc.dash; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        let ny = y + 40;
        ctx.textBaseline = "alphabetic"; ctx.font = IMGF.hand(44);
        if (gift.t) { ctx.fillStyle = tc.accent; ctx.fillText(`${gift.t},`, cardX + 60, ny + 38); ny += 52; }
        ctx.fillStyle = IMGC.ink;
        for (const l of noteLines) { ctx.fillText(l, cardX + 60, ny + 38); ny += 52; }
        ctx.textAlign = "right";
        if (signLine) { ctx.fillStyle = IMGC.walnutSoft; ctx.fillText(signLine, cardX + cardW - 90, ny + 38); ny += 52; }
        ctx.fillStyle = tc.accent; ctx.fillText(gift.f || "a friend", cardX + cardW - 70, ny + 38);
        ctx.textAlign = "left";
        ctx.restore();
      }
      y += nh + 36;
    }

    // the ticket
    const cardTop = y;
    const stubH = 128;
    y += stubH;
    y += 48;
    ctx.font = IMGF.display(600, 68);
    const titleLines = wrapLines(ctx, m.name, inW, 3);
    if (draw) { ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic"; titleLines.forEach((l, i) => ctx.fillText(l, inX, y + 58 + i * 78)); }
    y += titleLines.length * 78 + 18;
    ctx.font = IMGF.body(800, 36);
    const shortLines = wrapLines(ctx, m.short, inW, 4);
    if (draw) { ctx.fillStyle = IMGC.walnut; shortLines.forEach((l, i) => ctx.fillText(l, inX, y + 36 + i * 50)); }
    y += shortLines.length * 50 + 30;

    // tags
    const tags = [L.mode[m.mode] || m.mode, L.duration[m.duration] || m.duration, L.effort[m.effort] || m.effort,
      L.cost[m.cost] || m.cost, L.setting[m.setting] || m.setting,
      m.season && m.season !== "any" ? cap(joinList(m.season)) : null].filter(Boolean);
    ctx.font = IMGF.body(800, 28);
    let tx = inX, ty = y;
    tags.forEach((t, i) => {
      const tw = ctx.measureText(t).width + 40;
      if (tx + tw > inX + inW) { tx = inX; ty += 60; }
      if (draw) { rrect(ctx, tx, ty, tw, 48, 24); ctx.fillStyle = i === 0 ? IMGC.sageTint : IMGC.sand; ctx.fill();
        ctx.fillStyle = i === 0 ? IMGC.sageInk : IMGC.walnut; ctx.textBaseline = "middle"; ctx.fillText(t, tx + 20, ty + 25); }
      tx += tw + 12;
    });
    y = ty + 48 + 34;

    // where: place, address, coordinates
    if (m.place) {
      const pl = m.place;
      const boxTop = y;
      let by = y + 34;
      ctx.font = IMGF.body(900, 34);
      const nameLines = wrapLines(ctx, [pl.name, pl.area].filter(Boolean).join(", "), inW - 110, 3);
      if (draw) { ctx.textBaseline = "alphabetic"; ctx.fillStyle = IMGC.ink; nameLines.forEach((l, i) => ctx.fillText(l, inX + 86, by + 30 + i * 44)); }
      by += nameLines.length * 44 + 6;
      if (pl.address) {
        ctx.font = IMGF.body(700, 30);
        const addr = wrapLines(ctx, pl.address, inW - 110, 3);
        if (draw) { ctx.fillStyle = IMGC.walnut; addr.forEach((l, i) => ctx.fillText(l, inX + 86, by + 28 + i * 40)); }
        by += addr.length * 40 + 6;
      }
      if (c) {
        ctx.font = IMGF.body(800, 30);
        if (draw) { ctx.fillStyle = IMGC.sageDeep; ctx.fillText(`${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, inX + 86, by + 30); }
        by += 46;
      }
      by += 22;
      if (draw) {
        rrect(ctx, inX - 6, boxTop, inW + 12, by - boxTop, 24); ctx.fillStyle = IMGC.linen; ctx.fill();
        if (pinImg) ctx.drawImage(pinImg, inX + 24, boxTop + 30, 40, 40);
        // redraw text above the box fill
        let ry = boxTop + 34;
        ctx.font = IMGF.body(900, 34); ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic";
        nameLines.forEach((l, i) => ctx.fillText(l, inX + 86, ry + 30 + i * 44)); ry += nameLines.length * 44 + 6;
        if (pl.address) { ctx.font = IMGF.body(700, 30); ctx.fillStyle = IMGC.walnut;
          const addr = wrapLines(ctx, pl.address, inW - 110, 3); addr.forEach((l, i) => ctx.fillText(l, inX + 86, ry + 28 + i * 40)); ry += addr.length * 40 + 6; }
        if (c) { ctx.font = IMGF.body(800, 30); ctx.fillStyle = IMGC.sageDeep; ctx.fillText(`${c[0].toFixed(5)}, ${c[1].toFixed(5)}`, inX + 86, ry + 30); }
      }
      y = by + 28;
    }

    // check before you go
    if (m.check_ahead && m.check_ahead.length) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, `Check before you go: ${checkText(m)}`, inW - 56, 3);
      if (draw) { if (clockImg) ctx.drawImage(clockImg, inX, y + 2, 36, 36); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 54, y + 30 + i * 42)); }
      y += lines.length * 42 + 24;
    }
    if (m.discounts && m.discounts.length) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, `Ask about discounts: ${discountText(m)}`, inW - 56, 3);
      if (draw) { if (tagImg) ctx.drawImage(tagImg, inX, y + 2, 36, 36); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 54, y + 30 + i * 42)); }
      y += lines.length * 42 + 24;
    }
    // caution: a honey box with a warning sign
    if (warn) {
      ctx.font = IMGF.body(800, 30);
      const lines = wrapLines(ctx, warn, inW - 96, 6);
      const boxH = lines.length * 42 + 40;
      if (draw) {
        rrect(ctx, inX - 6, y, inW + 12, boxH, 22); ctx.fillStyle = IMGC.honeyTint; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = IMGC.honey; ctx.stroke();
        if (cautionImg) ctx.drawImage(cautionImg, inX + 16, y + 20, 38, 38);
        ctx.fillStyle = IMGC.ink; ctx.textBaseline = "alphabetic";
        lines.forEach((l, i) => ctx.fillText(l, inX + 70, y + 50 + i * 42));
      }
      y += boxH + 24;
    }

    // footer inside the ticket
    y += 12;
    if (draw) {
      ctx.setLineDash([6, 8]); ctx.strokeStyle = IMGC.lineStrong; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(inX, y); ctx.lineTo(inX + inW, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = IMGF.body(700, 28); ctx.fillStyle = IMGC.walnutSoft; ctx.textBaseline = "alphabetic";
      ctx.fillText(`Mission ${m.number || "?"} in ${pack.name}`, inX, y + 50);
    }
    y += 80;
    const cardBottom = y;

    if (draw) {   // card + stub, painted under everything above by drawing them first (see below)
      paint.card = { top: cardTop, bottom: cardBottom, stubH };
    }
    y += 34;
    if (draw) { ctx.font = IMGF.body(800, 30); ctx.fillStyle = IMGC.sageDeep; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText("amblebee.com", W / 2, y + 20); ctx.textAlign = "left"; }
    y += 20 + P;
    return { y, cardTop, cardBottom, stubH };
  };

  const size = paint(false);
  const H = Math.max(IMG.minH, Math.ceil(size.y));   // long missions and notes just make a taller image
  canvas.width = W; canvas.height = H;
  // background
  ctx.fillStyle = IMGC.oat; ctx.fillRect(0, 0, W, H);
  // the ticket card and its stub go down first, so the content paints on top
  const extra = Math.max(0, (H - size.y) / 2);   // center short missions vertically
  ctx.save(); ctx.translate(0, extra);
  ctx.save(); ctx.shadowColor = "rgba(90,62,43,.16)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
  rrect(ctx, cardX, size.cardTop, cardW, size.cardBottom - size.cardTop, 36); ctx.fillStyle = IMGC.paper; ctx.fill(); ctx.restore();
  ctx.save(); rrect(ctx, cardX, size.cardTop, cardW, size.cardBottom - size.cardTop, 36); ctx.clip();
  ctx.fillStyle = IMGC.sageDeep; ctx.fillRect(cardX, size.cardTop, cardW, size.stubH); ctx.restore();
  ctx.setLineDash([10, 9]); ctx.strokeStyle = IMGC.lineStrong; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cardX, size.cardTop + size.stubH + 2); ctx.lineTo(cardX + cardW, size.cardTop + size.stubH + 2); ctx.stroke(); ctx.setLineDash([]);
  if (packImg) ctx.drawImage(packImg, inX - 6, size.cardTop + 32, 64, 64);
  ctx.fillStyle = "#FFFDF8"; ctx.textBaseline = "middle";
  ctx.font = IMGF.body(800, 28); ctx.fillText("MISSION", inX + 76, size.cardTop + size.stubH / 2);
  const mw = ctx.measureText("MISSION ").width;
  ctx.font = IMGF.display(600, 60); ctx.fillText(String(m.number || "?"), inX + 76 + mw + 6, size.cardTop + size.stubH / 2 + 2);
  ctx.font = IMGF.body(800, 28); ctx.textAlign = "right"; ctx.fillText(pack.name || "", inX + inW, size.cardTop + size.stubH / 2); ctx.textAlign = "left";
  paint(true);
  ctx.restore();
  return canvas;
}
async function saveMissionImage(m, gift, btn) {
  const label = btn.lastChild, before = label.textContent;
  label.textContent = "Drawing…";
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all([document.fonts.load(IMGF.display(600, 68)), document.fonts.load(IMGF.body(800, 36)), document.fonts.load(IMGF.hand(44))]).catch(() => {});
    }
    const canvas = await drawMission(m, gift && gift.n ? gift : null);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const name = `amblebee-${String(m.id || m.full_id || "mission").replace(/[^a-z0-9-]+/gi, "-")}.png`;
    const file = new File([blob], name, { type: "image/png" });
    // iPhone/iPad: the share sheet has "Save Image", which puts it in Photos.
    // Android and computers: a normal download (on Android, Google Photos shows it under Library > Download).
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: m.name }); label.textContent = before; return; }
      catch (e) { if (e && e.name === "AbortError") { label.textContent = before; return; } }
    }
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    label.textContent = "Saved to Downloads";
    setTimeout(() => { label.textContent = before; }, 2200);
  } catch (e) {
    label.textContent = "Couldn't save, try again";
    setTimeout(() => { label.textContent = before; }, 2600);
  }
}
