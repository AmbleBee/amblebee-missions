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
