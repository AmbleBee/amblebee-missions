/* On 404.html only, before the page draws: an address like /fieldnotes/our-gear/ is a Field notes post, which
   site/js/fieldnotes.js fills in, so the "page not found" words stay hidden instead of flashing first. */
if (/^\/fieldnotes\/[a-z0-9][a-z0-9-]*\/?$/.test(location.pathname)) document.documentElement.classList.add("fn-route");
