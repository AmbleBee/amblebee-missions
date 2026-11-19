/* The homepage notices, only when there's something new for you:
   - a thank-you stamp AmbleBee gave you (from the admin), landing once with its reason, then it lives in your stamp book;
   - one line when a vote you started has ended and you haven't opened it yet (it goes once you open the vote:
     votes.js marks it seen).
   Reads what's already on this device and what the profile sync brought; nothing is fetched here. */
(function () {
  "use strict";
  var box = document.querySelector(".home-notes");
  if (!box) return;
  var giftNote = null;
  function ended() {
    var list;
    try { list = JSON.parse(localStorage.getItem("amble.votes") || "[]"); } catch (e) { list = []; }
    var now = Date.now();
    return (Array.isArray(list) ? list : []).filter(function (x) {
      return x && x.pub && x.role === "creator" && !x.seen && x.status !== "cancelled" &&
        (x.ended || (x.closes_at && new Date(x.closes_at).getTime() < now));
    });
  }
  function voteLine() {
    var v = ended()[0];
    if (!v) return null;
    var a = document.createElement("a");
    a.href = "/vote/?v=" + encodeURIComponent(v.pub);
    a.className = "home-note-link";
    var b = document.createElement("b");
    b.textContent = v.name || "Your vote";
    a.append("Voting's over for ", b, ". See who won ›");
    return a;
  }
  // a stamp given since this browser last looked lands here, once (AmbleStamps.freshGifts marks it seen)
  function gifts() {
    var ST = window.AmbleStamps;
    if (!ST || !ST.freshGifts) return;
    var news = ST.freshGifts();
    if (!news.length) return;
    var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    giftNote = ST.landing(news, !calm);
    giftNote.classList.add("home-gift");
    var why = document.createElement("p");
    why.className = "home-gift-why";
    why.textContent = news.map(function (s) { return s.how; }).join(" ") + " Thank you!";
    var words = giftNote.lastElementChild;
    words.insertBefore(why, words.lastElementChild);
    draw();
  }
  function draw() {
    var parts = [giftNote, voteLine()].filter(Boolean);
    box.replaceChildren.apply(box, parts);
    box.hidden = !parts.length;
  }
  draw();
  window.addEventListener("storage", function (e) { if (!e.key || e.key === "amble.votes") draw(); });
  // stamps.js loads after this file, and a sync can bring a new stamp at any moment
  document.addEventListener("DOMContentLoaded", gifts);
  window.addEventListener("amble:profile", gifts);
})();
