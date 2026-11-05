"""Seasonal looks for the website, kept separate from it in themes/ at the repo root.

    python tools/build_themes.py                 # just check themes/ (does nothing if there's no themes/ folder)
    python tools/build_themes.py --out _site     # add the themes to a built site (run after build_pages.py)

The website itself knows nothing about themes. When a themes/ folder exists, this script:
  - checks themes/seasons.yaml (the schedule) and every theme's colors, with the same readability rules as
    tools/check_contrast.py, in light and dark mode
  - writes _site/themes/themes.css (every theme, plus the shared bits in themes/_base.css) and
    _site/themes/season.js (the schedule and the footer switch)
  - adds two lines to every page, right after style.css, that load those two files
A season with `flurry: true` gets a shower of falling things (leaves, snow; the theme's CSS draws them) on the
first page of a visit and on refresh. It falls down the whole page, so it stays put when you scroll and catches
up with you. Never for visitors who ask their device for reduced motion, and never once the look is turned off.
With no themes/ folder it prints one line and changes nothing, so the built site is exactly as before.

On the site, season.js picks today's look before the page is drawn (no flash of the plain colors), and the
footer gets a "Turn it off" switch that the browser remembers. On localhost (bash tools/preview.sh) a small
picker in the corner previews any theme on any day.
"""
import argparse
import calendar
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
THEMES = ROOT / "themes"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_contrast import MIN_RATIO, PAIRS, ratio, tokens  # noqa: E402

KEYS = {"theme", "name", "from", "to", "message", "flurry"}
MMDD = re.compile(r"^(\d{2})-(\d{2})$")
# every page links style.css (with or without a leading slash, with or without a ?v= after the build)
STYLE_LINK = re.compile(r'<link rel="stylesheet" href="/?style\.css(?:\?v=[0-9a-f]+)?">')


def day_of_year(mmdd):
    m = MMDD.match(mmdd)
    if not m:
        raise ValueError
    month, day = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12 and 1 <= day <= calendar.monthrange(2024, month)[1]):   # 2024: Feb 29 is allowed
        raise ValueError
    return sum(calendar.monthrange(2024, mo)[1] for mo in range(1, month)) + day


def days_in(entry):
    a, b = day_of_year(entry["from"]), day_of_year(entry["to"])
    return set(range(a, b + 1)) if a <= b else set(range(a, 367)) | set(range(1, b + 1))


def theme_tokens(css, theme):
    """(light, dark) color tokens a theme sets, from its html[data-season="..."] blocks."""
    sel = re.escape(f'html[data-season="{theme}"]')
    light = re.search(r"(?:^|\n)" + sel + r"\s*\{(.*?)\n\}", css, re.S)
    dark = re.search(r"prefers-color-scheme: dark\)\s*\{\s*" + sel + r"\s*\{(.*?)\n\s*\}", css, re.S)
    return tokens(light.group(1)) if light else {}, tokens(dark.group(1)) if dark else {}


def base_tokens():
    css = (ROOT / "site" / "style.css").read_text(encoding="utf-8")
    light = tokens(re.search(r":root \{(.*?)\n\}", css, re.S).group(1))
    dark = {**light, **tokens(re.search(r"prefers-color-scheme: dark\) \{\s*:root \{(.*?)\n\s*\}", css, re.S).group(1))}
    return light, dark


def load():
    """(schedule, {theme: css}, problems)."""
    problems, css = [], {}
    for folder in sorted(p for p in THEMES.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
        f = folder / "theme.css"
        if not f.exists():
            problems.append(f"themes/{folder.name}/: needs a theme.css")
        else:
            css[folder.name] = f.read_text(encoding="utf-8")
    sched_file = THEMES / "seasons.yaml"
    if not sched_file.exists():
        return [], css, problems + ["themes/seasons.yaml is missing (it says which theme shows when)"]
    try:
        schedule = yaml.safe_load(sched_file.read_text(encoding="utf-8")) or []
    except yaml.YAMLError as e:
        return [], css, problems + [f"themes/seasons.yaml isn't valid YAML: {e}"]
    if not isinstance(schedule, list):
        return [], css, problems + ["themes/seasons.yaml should be a list of entries, each starting with '- theme:'"]
    clean = []
    for i, e in enumerate(schedule, 1):
        where = f"seasons.yaml entry {i}" + (f" ({e.get('theme')})" if isinstance(e, dict) and e.get("theme") else "")
        if not isinstance(e, dict):
            problems.append(f"{where}: should be a set of fields (theme, name, from, to)")
            continue
        for k in sorted(set(e) - KEYS):
            problems.append(f"{where}: unknown field '{k}' (fields: {', '.join(sorted(KEYS))})")
        for k in ("theme", "name", "from", "to"):
            if not e.get(k):
                problems.append(f"{where}: needs '{k}'")
        if "flurry" in e and not isinstance(e["flurry"], bool):
            problems.append(f"{where}: flurry should be true or false")
        if e.get("theme") and e["theme"] not in css:
            problems.append(f"{where}: there's no themes/{e['theme']}/theme.css")
        ok = True
        for k in ("from", "to"):
            v = str(e.get(k, "")).strip()
            try:
                day_of_year(v)
            except ValueError:
                problems.append(f"{where}: {k} should be a month and day like \"11-01\" (MM-DD, in quotes)")
                ok = False
        if ok and all(e.get(k) for k in ("theme", "name")):
            clean.append({"theme": str(e["theme"]), "name": str(e["name"]).strip(), "from": str(e["from"]).strip(),
                          "to": str(e["to"]).strip(), "message": str(e.get("message") or "").strip(),
                          "flurry": bool(e.get("flurry"))})
    for i, a in enumerate(clean):
        for b in clean[i + 1:]:
            if days_in(a) & days_in(b):
                problems.append(f"seasons.yaml: {a['name']} ({a['from']} to {a['to']}) and {b['name']} "
                                f"({b['from']} to {b['to']}) overlap; only one look can show on a day")
    # colors: the same readability rules as the plain site, in light and dark mode
    base_light, base_dark = base_tokens()
    for theme, text in css.items():
        if f'html[data-season="{theme}"]' not in text:
            problems.append(f'themes/{theme}/theme.css: every rule should start with html[data-season="{theme}"], '
                            "so the theme only applies while it's on")
            continue
        light, dark = theme_tokens(text, theme)
        missing = sorted(set(light) - set(dark))
        if missing:
            problems.append(f"themes/{theme}/theme.css: the dark-mode block also needs {', '.join('--' + m for m in missing)} "
                            "(otherwise dark mode would get the light colors)")
        if "foot-bg" in light or "foot-bg" in dark:
            problems.append(f"themes/{theme}/theme.css: leave --foot-bg alone; the footer keeps its color in every theme")
        for mode, colors in (("light", {**base_light, **light}), ("dark", {**base_dark, **light, **dark})):
            for fg, bg in PAIRS:
                a, b = colors.get(fg, fg), colors[bg]
                if ratio(a, b) < MIN_RATIO:
                    problems.append(f"themes/{theme} ({mode}): {fg} on {bg} is {ratio(a, b):.2f}:1 ({a} on {b}); "
                                    f"needs {MIN_RATIO}:1")
    return clean, css, problems


SEASON_JS = r"""/* Seasonal looks for AmbleBee, built by tools/build_themes.py from themes/seasons.yaml. Don't edit by hand.
   Runs in <head> before the page is drawn: picks today's look (or none), so the plain colors never flash first.
   The footer gets a switch to turn it off (remembered in this browser). On localhost a picker previews any theme. */
(function () {
  var SEASONS = __SEASONS__;
  var THEMES = __THEMES__;
  var root = document.documentElement;
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function get(kind, key) { try { return window[kind].getItem(key); } catch (e) { return null; } }
  function set(kind, key, value) {
    try { if (value === null) window[kind].removeItem(key); else window[kind].setItem(key, value); } catch (e) {}
  }
  var d = new Date();
  var today = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  function inSeason(s) { return s.from <= s.to ? (today >= s.from && today <= s.to) : (today >= s.from || today <= s.to); }
  var current = SEASONS.filter(inSeason)[0] || null;

  var preview = null;   // localhost only: "plain" or a theme name, kept for this tab
  if (LOCAL) {
    var asked = new URLSearchParams(location.search).get("season");
    if (asked) set("sessionStorage", "amble-season-preview", asked === "auto" ? null : asked);
    preview = get("sessionStorage", "amble-season-preview");
    if (preview && preview !== "plain" && !THEMES[preview]) preview = null;
  }
  function info(theme) {
    var s = SEASONS.filter(function (x) { return x.theme === theme; })[0];
    return s || { theme: theme, name: THEMES[theme], message: "" };
  }
  var shown = preview ? (preview === "plain" ? null : info(preview)) : current;
  function off() { return !preview && get("localStorage", "amble-seasonal-look") === "off"; }
  function apply() {
    if (shown && !off()) root.setAttribute("data-season", shown.theme);
    else root.removeAttribute("data-season");
  }
  apply();

  function footerSwitch() {
    var foot = document.querySelector(".foot");
    if (!foot || !shown) return;
    var p = document.createElement("p");
    p.className = "season-switch";
    function draw() {
      p.textContent = "";
      var text = document.createElement("span");
      var btn = document.createElement("button");
      btn.type = "button";
      if (off()) {
        text.textContent = "The seasonal look is off. ";
        btn.textContent = "Turn the " + shown.name + " look back on";
      } else {
        text.textContent = shown.message ? shown.message + " " : "";
        btn.textContent = preview ? "Previewing the " + shown.name + " look" : "Turn off the " + shown.name + " look";
        btn.disabled = !!preview;
      }
      btn.addEventListener("click", function () {
        set("localStorage", "amble-seasonal-look", off() ? null : "off");
        apply(); draw();
        if (off()) stopFlurry();
      });
      p.appendChild(text); p.appendChild(btn);
    }
    draw();
    foot.insertBefore(p, foot.firstChild);
  }

  function previewPicker() {
    if (!LOCAL) return;
    var box = document.createElement("div");
    box.className = "season-preview";
    var label = document.createElement("label");
    label.textContent = "Theme preview ";
    var sel = document.createElement("select");
    var opts = [["auto", "By today's date" + (current ? " (" + current.name + ")" : " (plain)")], ["plain", "Plain"]];
    Object.keys(THEMES).forEach(function (t) { opts.push([t, THEMES[t]]); });
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o[0]; op.textContent = o[1];
      if ((preview || "auto") === o[0]) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener("change", function () {
      set("sessionStorage", "amble-season-preview", sel.value === "auto" ? null : sel.value);
      location.reload();
    });
    label.appendChild(sel); box.appendChild(label);
    document.body.appendChild(box);
  }

  // A shower of leaves or snow that falls down the whole page, not the screen: scroll ahead and it catches up
  // with you. Plays on the first page of a visit and when the page is refreshed. Each piece falls at its own
  // speed and sways a little, and is gone once it reaches the bottom of the page (or after 90 seconds).
  var flurryRun = null;
  function stopFlurry() {
    if (flurryRun) { cancelAnimationFrame(flurryRun.frame); flurryRun = null; }
    var f = document.querySelector(".season-flurry");
    if (f) f.parentNode.removeChild(f);
  }
  function flurry() {
    if (!shown || !shown.flurry || off()) return;
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.requestAnimationFrame) return;
    var nav = (window.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {};
    var reloaded = nav.type === "reload" || !!(window.performance && performance.navigation && performance.navigation.type === 1);
    if (get("sessionStorage", "amble-flurry-seen") && !reloaded) return;
    set("sessionStorage", "amble-flurry-seen", "1");

    var box = document.createElement("div");
    box.className = "season-flurry";
    box.setAttribute("aria-hidden", "true");
    function r(a, b) { return a + Math.random() * (b - a); }
    var screen = window.innerHeight || 800, count = window.innerWidth < 600 ? 14 : 26, pieces = [];
    for (var i = 0; i < count; i++) {
      var el = document.createElement("span"), size = r(10, 20);
      el.style.setProperty("--size", size.toFixed(1) + "px");
      el.style.setProperty("--alpha", r(.65, .95).toFixed(2));
      el.style.transform = "translate3d(-100px, -100px, 0)";
      box.appendChild(el);
      pieces.push({ el: el, size: size, x: r(0, 1), y: -size - r(0, screen * .35), wait: r(0, 4.5),
                    speed: screen / r(6.5, 9),                       // about one screen height every 7-8 seconds
                    sway: r(18, 55), swaySpeed: r(.5, 1.1), phase: r(0, 6.3), angle: r(0, 360), spin: r(-70, 70) });
    }
    document.body.appendChild(box);
    var last = null, age = 0;
    function frame(now) {
      var dt = last === null ? 0 : Math.min(.05, (now - last) / 1000);   // a hidden tab pauses, it doesn't jump
      last = now; age += dt;
      var width = document.documentElement.clientWidth, bottom = document.documentElement.scrollHeight, alive = 0;
      for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i];
        if (p.gone) continue;
        if (age < p.wait) { alive++; continue; }
        p.y += p.speed * dt;
        p.angle += p.spin * dt;
        if (p.y + p.size >= bottom - 2) { p.gone = true; p.el.style.display = "none"; continue; }
        alive++;
        var room = width - p.size * 1.5;                                  // a tilted piece is wider than it is
        var x = p.x * room + Math.sin(p.phase + (age - p.wait) * p.swaySpeed) * p.sway;
        x = Math.max(p.size * .25, Math.min(room, x));                   // never past the page's edges
        p.el.style.transform = "translate3d(" + x.toFixed(1) + "px," + p.y.toFixed(1) + "px,0) rotate(" + p.angle.toFixed(0) + "deg)";
      }
      if (!alive || age > 90) return stopFlurry();
      flurryRun.frame = requestAnimationFrame(frame);
    }
    flurryRun = { frame: requestAnimationFrame(frame) };
  }

  function ready() { footerSwitch(); previewPicker(); flurry(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
"""


def build(out, schedule, css):
    dest = out / "themes"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    names = {s["theme"]: s["name"] for s in schedule}
    names.update({t: names.get(t, t.replace("-", " ").title()) for t in css})
    parts = []
    if (THEMES / "_base.css").exists():
        parts.append((THEMES / "_base.css").read_text(encoding="utf-8"))
    for theme, text in css.items():
        parts.append(f"/* ---------- themes/{theme}/theme.css ---------- */\n{text}")
        for f in (THEMES / theme).iterdir():   # pictures a theme uses sit next to it: url("fall/leaf.svg")
            if f.is_file() and f.name != "theme.css":
                (dest / theme).mkdir(exist_ok=True)
                shutil.copy2(f, dest / theme / f.name)
    (dest / "themes.css").write_text("\n\n".join(parts), encoding="utf-8")
    js = SEASON_JS.replace("__SEASONS__", json.dumps(schedule, ensure_ascii=False)).replace(
        "__THEMES__", json.dumps(names, ensure_ascii=False))
    (dest / "season.js").write_text(js, encoding="utf-8")

    v = {n: hashlib.sha256((dest / n).read_bytes()).hexdigest()[:10] for n in ("themes.css", "season.js")}
    hook = (f'\n<link rel="stylesheet" href="/themes/themes.css?v={v["themes.css"]}">'
            f'\n<script src="/themes/season.js?v={v["season.js"]}"></script>')
    pages = missed = 0
    for f in sorted(out.rglob("*.html")):
        if dest in f.parents or f.parent.name == "cards":
            continue
        text = f.read_text(encoding="utf-8")
        if "/themes/season.js" in text:
            continue
        new, n = STYLE_LINK.subn(lambda m: m.group(0) + hook, text, count=1)
        if n:
            f.write_text(new, encoding="utf-8")
            pages += 1
        else:
            missed += 1
    return pages, missed


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", help="the built site folder (_site) to add the themes to")
    args = ap.parse_args()
    if not THEMES.is_dir():
        print("No themes/ folder, so the site stays plain (nothing to do)")
        return
    schedule, css, problems = load()
    if problems:
        sys.exit("Seasonal themes need a fix:\n  - " + "\n  - ".join(problems))
    when = ", ".join(f"{s['name']} {s['from']} to {s['to']}" for s in schedule) or "nothing scheduled"
    if not args.out:
        print(f"Themes OK: {len(css)} theme(s); {when}")
        return
    pages, missed = build(Path(args.out), schedule, css)
    print(f"Themes added to {pages} pages ({when})" + (f"; {missed} page(s) had no style.css link" if missed else ""))


if __name__ == "__main__":
    main()
