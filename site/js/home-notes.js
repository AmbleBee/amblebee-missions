/* The homepage notice: one line, only when a vote you started has ended and you haven't opened it yet.
   It goes once you open the vote (votes.js marks it seen). Reads what votes.js keeps on this device; nothing is fetched. */
(function () {
  "use strict";
  var box = document.querySelector(".home-notes");
  if (!box) return;
  function ended() {
    var list;
    try { list = JSON.parse(localStorage.getItem("amble.votes") || "[]"); } catch (e) { list = []; }
    var now = Date.now();
    return (Array.isArray(list) ? list : []).filter(function (x) {
      return x && x.pub && x.role === "creator" && !x.seen && x.status !== "cancelled" &&
        (x.ended || (x.closes_at && new Date(x.closes_at).getTime() < now));
    });
  }
  function draw() {
    var v = ended()[0];
    if (!v) { box.hidden = true; box.textContent = ""; return; }
    var a = document.createElement("a");
    a.href = "/vote/?v=" + encodeURIComponent(v.pub);
    a.className = "home-note-link";
    var b = document.createElement("b");
    b.textContent = v.name || "Your vote";
    a.append("Voting's over for ", b, ". See who won \u203a");
    box.replaceChildren(a);
    box.hidden = false;
  }
  draw();
  window.addEventListener("storage", function (e) { if (!e.key || e.key === "amble.votes") draw(); });
})();
