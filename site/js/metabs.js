/* The tabs across the top of Your profile (tools/build_pages.py profile_top): how many plans are coming up on
   Plans, and a honey dot on Messages when a reply is waiting. Both read what's already on this device. */
"use strict";
(function () {
  var tabs = document.querySelector(".me-tabs");
  if (!tabs) return;
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function paint() {
    var D = window.AmbleDone, P = window.AmbleProfile;
    var plans = D && D.plans ? D.plans().filter(function (x) { return !x.day || x.day >= today(); }).length : 0;
    var n = tabs.querySelector('[data-tab="plans"] .me-tab-n');
    if (n) { n.textContent = plans ? String(plans) : ""; n.hidden = !plans; n.setAttribute("aria-label", plans + (plans === 1 ? " plan" : " plans")); }
    var unread = P && P.state ? P.state().unread : 0;
    var dot = tabs.querySelector('[data-tab="messages"] .me-tab-dot');
    if (dot) dot.hidden = !unread;
  }
  window.addEventListener("amble:done", paint);
  window.addEventListener("amble:profile", paint);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint); else paint();
})();
