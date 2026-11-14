/* The FAQ page (pages/faq.html): a search box that filters the questions as you type, and links like
   /faq/#statuses that open that answer. Without JavaScript every question still opens and closes on its own
   (they're <details>), and the search box stays hidden. Nothing typed here leaves the page. */
(function () {
  "use strict";
  var box = document.querySelector(".faq-search");
  if (!box) return;
  var input = box.querySelector("input");
  var count = box.querySelector(".faq-count");
  var none = document.querySelector(".faq-none");
  var items = [].slice.call(document.querySelectorAll(".faq-item"));
  var groups = [].slice.call(document.querySelectorAll(".faq-group"));
  var OPEN_ALL = 4;   // open every match when there are this few; more than that, just list the questions

  // lower case, no accents or apostrophes, so "dont", "don't" and "Don’t" all match
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, "").replace(/[^a-z0-9$]+/g, " ").trim();
  }
  // each answer is searched by its question, its answer, and a few extra words people might use (data-also)
  var text = items.map(function (it) { return " " + norm(it.textContent + " " + (it.getAttribute("data-also") || "")) + " "; });
  var before = null;   // which answers were open before searching, put back when the box is cleared

  function run() {
    var q = norm(input.value);
    var words = q ? q.split(" ") : [];
    if (!words.length) {
      items.forEach(function (it, n) { it.hidden = false; if (before) it.open = before[n]; });
      groups.forEach(function (g) { g.hidden = false; });
      before = null;
      count.textContent = "";
      none.hidden = true;
      return;
    }
    if (!before) before = items.map(function (it) { return it.open; });
    var hits = items.map(function (it, n) {
      // every word has to appear; the last one can be half typed ("del" finds "delete")
      return words.every(function (w, i) {
        return i === words.length - 1 ? text[n].indexOf(" " + w) !== -1 || text[n].indexOf(w) !== -1 : text[n].indexOf(w) !== -1;
      });
    });
    var shown = hits.filter(Boolean).length;
    items.forEach(function (it, n) { it.hidden = !hits[n]; it.open = hits[n] && shown <= OPEN_ALL; });
    groups.forEach(function (g) { g.hidden = !g.querySelector(".faq-item:not([hidden])"); });
    count.textContent = shown ? shown + (shown === 1 ? " answer matches" : " answers match") : "";
    none.hidden = shown > 0;
    none.querySelector("span").textContent = input.value.trim();
  }

  function openFromAddress() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ""));
    var it = id && document.getElementById(id);
    if (!it || !it.classList.contains("faq-item")) return;
    if (input.value) { input.value = ""; run(); }
    it.open = true;
    it.scrollIntoView({ block: "start" });
    it.querySelector("summary").focus({ preventScroll: true });
  }

  box.hidden = false;
  input.addEventListener("input", run);
  input.addEventListener("keydown", function (e) { if (e.key === "Escape" && input.value) { input.value = ""; run(); } });
  window.addEventListener("hashchange", openFromAddress);
  var asked = new URLSearchParams(location.search).get("q");   // /faq/?q=credit opens with that search
  if (asked) { input.value = asked.slice(0, 80); run(); }
  openFromAddress();
})();
