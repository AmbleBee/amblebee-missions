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

/* The profile menu (calendar-voting-PLAN.md, decision 46): the profile button opens a short menu instead of going
   straight to Your profile. Without JavaScript it's still a plain link to /me/. Messages joined in branch 2, with a red
   dot when AmbleBee has replied (the only red dots on the site); Votes joins later. */
(function () {
  var btn = document.querySelector(".top nav > a.nav-profile");
  var nav = btn && btn.parentElement;
  if (!btn || !nav) return;
  var panel = document.createElement("div");
  panel.className = "profile-menu";
  panel.id = "profile-menu";
  panel.hidden = true;
  nav.appendChild(panel);
  btn.setAttribute("aria-controls", "profile-menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-haspopup", "true");

  function has() {
    try { var st = JSON.parse(localStorage.getItem("amble.profile") || "null"); return !!(st && st.key && !st.gone); } catch (e) { return false; }
  }
  // plans whose day has passed, waiting on "Did you go?" (site/js/plans.js): a honey dot on the icon and on My plans
  // (red dots are only ever for replies from AmbleBee)
  function waiting() {
    try {
      var d = JSON.parse(localStorage.getItem("amble.done") || "null"), t = new Date(), cut = new Date();
      cut.setDate(cut.getDate() - 60);
      var day = function (x) { return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2); };
      var today = day(t), oldest = day(cut);
      return ((d && d.plans) || []).filter(function (x) { return x && x.day < today && x.day >= oldest; }).length;
    } catch (e) { return 0; }
  }
  // conversations with a reply from AmbleBee not yet read (site/js/profile.js keeps the count from each sync)
  function unread() {
    try { var st = JSON.parse(localStorage.getItem("amble.profile") || "null"); return st && st.key && !st.gone ? st.unread || 0 : 0; } catch (e) { return 0; }
  }
  var dot = document.createElement("span");
  dot.className = "nav-dot";
  dot.setAttribute("aria-hidden", "true");
  function paintDot() {
    var n = waiting(), r = unread();
    dot.hidden = !n && !r;
    dot.classList.toggle("is-reply", !!r);          // a reply wins: red
    if (!dot.parentNode) btn.appendChild(dot);
    var sr = btn.querySelector(".sr");
    if (sr) sr.textContent = sr.textContent.replace(/(, \d+ new repl(y|ies))?(, \d+ plans? to check)?$/, "") +
      (r ? ", " + r + (r === 1 ? " new reply" : " new replies") : "") + (n ? ", " + n + (n === 1 ? " plan" : " plans") + " to check" : "");
  }
  paintDot();
  window.addEventListener("amble:done", paintDot);
  window.addEventListener("amble:profile", function () { setTimeout(paintDot, 0); });
  window.addEventListener("storage", function (e) { if (e.key === "amble.done" || e.key === "amble.profile") setTimeout(paintDot, 0); });
  function item(href, text, here, dots, red) {
    var a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    if (here) a.setAttribute("aria-current", "page");
    if (dots) {
      var d = document.createElement("span"); d.className = "nav-dot" + (red ? " is-reply" : ""); d.setAttribute("aria-hidden", "true");
      var sr = document.createElement("span"); sr.className = "sr";
      sr.textContent = red ? " (" + dots + (dots === 1 ? " new reply)" : " new replies)") : " (Did you go? " + dots + " waiting)";
      a.append(d, sr);
    }
    return a;
  }
  function fill() {
    var path = location.pathname;
    var items = [
      item("/me/", has() ? "My profile" : "My stamps and missions", path === "/me/"),
      item("/me/plans/", "My plans", path === "/me/plans/", waiting()),
    ];
    if (has()) items.push(item("/me/messages/", "Messages", path === "/me/messages/", unread(), true));
    items.push(item("/contact/", "Support", path === "/contact/"));
    if (!has()) items.push(item("/me/settings/", "Start a free profile", false));
    panel.replaceChildren.apply(panel, items);
    if (!has()) panel.lastChild.className = "profile-menu-start";
  }
  function place() {
    var n = nav.getBoundingClientRect(), b = btn.getBoundingClientRect();
    panel.style.right = Math.max(0, n.right - b.right) + "px";
  }
  function show(focusFirst) {
    fill(); place();
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (focusFirst && panel.firstChild) panel.firstChild.focus();
  }
  function hide(refocus) {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  }
  // From the keyboard: Enter or Space on the button opens it and moves to the first item. Handled on keydown (whose
  // default is stopped, so no click follows), because browsers don't agree on how to tell a keyboard click apart.
  btn.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
      e.preventDefault();
      if (panel.hidden) show(true); else hide(true);
    }
  });
  btn.addEventListener("click", function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;   // "open in a new tab" still works
    e.preventDefault();
    if (panel.hidden) show(false); else hide(false);
  });
  document.addEventListener("keydown", function (e) {
    if (panel.hidden) return;
    if (e.key === "Escape") { hide(true); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      var links = Array.prototype.slice.call(panel.querySelectorAll("a"));
      var i = links.indexOf(document.activeElement);
      e.preventDefault();
      links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus();
    }
  });
  document.addEventListener("click", function (e) { if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) hide(false); });
  panel.addEventListener("focusout", function (e) { if (!panel.hidden && e.relatedTarget && !panel.contains(e.relatedTarget) && e.relatedTarget !== btn) hide(false); });
  window.addEventListener("resize", function () { if (!panel.hidden) place(); });
})();
