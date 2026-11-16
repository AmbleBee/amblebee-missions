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

/* The Profile button in the header fills in when this browser has a profile (site/js/profile.js), so it's easy to
   see that your missions are being saved. Only reads this browser's own storage. */
(function () {
  var btn = document.querySelector(".top .nav-profile");
  if (!btn) return;
  function paint() {
    var on = false;
    try { var st = JSON.parse(localStorage.getItem("amble.profile") || "null"); on = !!(st && st.key && !st.gone); } catch (e) { on = false; }
    btn.classList.toggle("has-profile", on);
    btn.title = on ? "Profile (saved)" : "Profile";
    var sr = btn.querySelector(".sr");
    if (sr) sr.textContent = on ? "Profile, saved" : "Profile";
  }
  paint();
  window.addEventListener("amble:profile", paint);
  window.addEventListener("storage", function (e) { if (e.key === "amble.profile") paint(); });
})();
