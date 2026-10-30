/* Mission pages: hide a temporary caution once its end date has passed, even if the site hasn't rebuilt yet. */
(function () {
  var d = new Date();
  var today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  document.querySelectorAll("[data-until]").forEach(function (e) {
    if (today > e.dataset.until) e.remove();
  });
})();
