/* The header menu is a plain <details>, so it opens without any script. This adds the expected extras:
   Escape, a tap outside, or choosing a link closes it. */
(function () {
  var menu = document.querySelector(".top .menu");
  if (!menu) return;
  var close = function () { menu.open = false; };
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && menu.open) { close(); menu.querySelector("summary").focus(); }
  });
  document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) close(); });
  menu.addEventListener("click", function (e) { if (e.target.closest("a")) close(); });
})();

/* "New to AmbleBee?" is for first-timers who land on a mission page from Google or a shared link. Once
   someone has opened a mission here or looked around a few pages, it's hidden. Only a page count and a
   yes/no are kept, in this browser; nothing is sent anywhere, and search engines always see the box. */
(function () {
  var visits = 0, used = false;
  try {
    visits = parseInt(localStorage.getItem("amble.visits") || "0", 10) || 0;
    used = localStorage.getItem("amble.used") === "1";
    localStorage.setItem("amble.visits", String(Math.min(visits + 1, 99)));
  } catch (e) { return; }      // storage blocked: everyone keeps seeing the box, which is fine
  if (used || visits >= 3) {
    var box = document.querySelector(".welcome");
    if (box) box.remove();
  }
})();
