/* Optional visitor stats with Google Analytics 4. Nothing loads, and nothing goes to Google, until a visitor
   says yes on the little banner. Their answer is kept in this browser ("amble.stats" = "yes" or "no"), and the
   Privacy page has buttons to change it (any button with data-stats="yes" or "no").

   To switch it on, paste the Measurement ID from Google Analytics below (Admin > Data streams > your stream).
   Left empty, the banner never shows and the site sends nothing to Google.
   Stats only run on amblebee.com itself, so local previews and the test browsers never count as visits. */
(function () {
  var GA_ID = "G-NVS82GGNWF";
  var KEY = "amble.stats";
  var live = !!GA_ID && /^(www\.)?amblebee\.com$/.test(location.hostname) && !navigator.webdriver;
  var loaded = false;

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: asked again next visit */ } }

  // only the page itself goes to Google: never the filters or search words in the address, or a card in the #link
  function cleanAddress() { return location.origin + location.pathname; }

  // A few actions, by name only, for people who said yes. The rest of the site calls ambleTrack();
  // it does nothing until stats are loaded, so callers never need to check.
  window.ambleTrack = function (name, params) {
    if (loaded && window.gtag) window.gtag("event", name, params || {});
  };
  var REPORT_ID_FIELD = "entry.872618061";   // the mission id field on the "Report a problem" form (site/js/core.js)
  function watchActions() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      if (/forms\.gle\//.test(a.href)) window.ambleTrack("suggest_click");
      else if (/docs\.google\.com\/forms\//.test(a.href)) {
        var id = null;
        try { id = new URL(a.href).searchParams.get(REPORT_ID_FIELD); } catch (err) { /* old browser: count without the id */ }
        window.ambleTrack("report_click", id ? { mission_id: id } : {});
      }
    }, true);
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.name === "mode" && t.checked) window.ambleTrack("mode_pick", { mode: t.value });
    });
  }

  function load() {
    if (loaded || !live) return;
    loaded = true;
    window["ga-disable-" + GA_ID] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, {
      page_location: cleanAddress(),
      page_referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : "",
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function stop() {
    if (GA_ID) window["ga-disable-" + GA_ID] = true;
    // remove the cookies Google Analytics set, on this host and on the whole domain
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (!/^_ga/.test(name)) return;
      ["", "; domain=" + location.hostname, "; domain=." + location.hostname.replace(/^www\./, "")].forEach(function (d) {
        document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/" + d;
      });
    });
  }

  function showStatus() {
    var choice = read();
    document.querySelectorAll("[data-stats-status]").forEach(function (el) {
      el.textContent = !GA_ID ? "Visitor stats are switched off on this site right now, so there's nothing to choose."
        : choice === "yes" ? "You said yes: this browser is counted."
        : choice === "no" ? "You said no: this browser isn't counted."
        : "You haven't chosen yet, so this browser isn't counted.";
    });
  }

  function choose(v) {
    write(v);
    if (v === "yes") load(); else stop();
    var ask = document.querySelector(".stats-ask");
    if (ask) ask.remove();
    showStatus();
  }

  function ask() {
    var box = document.createElement("div");
    box.className = "stats-ask";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Visitor stats");
    box.innerHTML = '<p><b>Can we count your visit?</b> If you say yes, Google Analytics counts which pages you open, '
      + 'using a cookie, so we can see which missions people like. No ads, and nothing you type is sent. '
      + '<a href="/privacy/#stats">More about this</a></p>'
      + '<div class="stats-btns"><button type="button" class="btn small" data-stats="no">No thanks</button>'
      + '<button type="button" class="btn small" data-stats="yes">Yes, count me</button></div>';
    document.body.appendChild(box);
  }

  function start() {
    watchActions();
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-stats]");
      if (b && GA_ID) choose(b.getAttribute("data-stats"));
    });
    document.querySelectorAll("[data-stats]").forEach(function (b) { if (!GA_ID) b.disabled = true; });
    showStatus();
    var choice = read();
    if (choice === "yes") load();
    else if (choice === null && live) ask();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
