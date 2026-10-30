/* Opening a shared or gift link: hide the home page before it's drawn, so the letter shows first.
   app.js removes this once the letter is ready (or after a few seconds, just in case). */
(function () {
  if (!/(?:^#|&)(gift|mission)=/.test(location.hash)) return;
  var d = document.documentElement;
  d.classList.add("arriving");
  setTimeout(function () { d.classList.remove("arriving"); }, 6000);
})();
