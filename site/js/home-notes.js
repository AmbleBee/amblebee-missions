/* The homepage strip for signed-in people: votes of yours that ended and you haven't looked at ("see who won"),
   plus Start a vote and Your votes. Reads what votes.js keeps on this device; nothing is fetched. */
(function () {
  "use strict";
  var box = document.querySelector(".home-notes");
  var P = window.AmbleProfile;
  if (!box || !P) return;
  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) { [].concat(arguments[i]).forEach(function (c) { if (c != null) e.append(c); }); }
    return e;
  }
  function ended() {
    var list;
    try { list = JSON.parse(localStorage.getItem("amble.votes") || "[]"); } catch (e) { list = []; }
    var now = Date.now();
    return (Array.isArray(list) ? list : []).filter(function (x) {
      return x && x.pub && !x.seen && x.status !== "cancelled" && (x.ended || (x.closes_at && new Date(x.closes_at).getTime() < now));
    });
  }
  function draw() {
    var st = P.state();
    if (!st.has || st.pinNeeded) { box.hidden = true; box.replaceChildren(); return; }
    var over = ended().slice(0, 2);
    box.replaceChildren(
      over.length ? el("ul", { class: "home-notes-list" }, over.map(function (x) {
        return el("li", {}, "Voting's over for ", el("b", { text: x.name || "your vote" }), ". ",
          el("a", { href: "/vote/?v=" + encodeURIComponent(x.pub), text: "See who won" }));
      })) : null,
      el("p", { class: "home-notes-row" },
        el("a", { class: "btn small primary", href: "/vote/new/", text: "Start a vote" }),
        el("a", { class: "btn small", href: "/me/votes/", text: "Your votes" })));
    box.hidden = false;
  }
  draw();
  window.addEventListener("amble:profile", draw);
  window.addEventListener("storage", function (e) { if (!e.key || e.key === "amble.votes") draw(); });
})();
