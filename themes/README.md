# Seasonal themes

Optional seasonal looks for amblebee.com. The website doesn't depend on anything in here: delete this
folder and the site is plain all year, with no errors and no extra requests.

| File | What it does |
|---|---|
| `seasons.yaml` | Which look shows when (month and day, every year). Edit, push, done |
| `_base.css` | Shared bits: the footer's on/off switch and the localhost preview picker |
| `fall/theme.css` | Fall & Thanksgiving: harvest accents, a leaf garland, leaves piled on the footer and the envelope, falling leaves on arrival |
| `winter/theme.css` | Winter: evergreen accents, a string of lights, snow and icicles on the footer, snow on the envelope, a snow flurry on arrival |

## How it works

`tools/build_themes.py` runs after the site is built. If this folder exists, it checks the schedule and every
theme's colors (same readability rules as the plain site, light and dark), then adds two lines to each page
that load the themes. A small script picks today's look before the page is drawn, so the plain colors never
flash first. Visitors can turn the look off in the footer, and their browser remembers.

A season with `flurry: true` in `seasons.yaml` also gets a shower of falling leaves or snow on the first page
of a visit and whenever the page is refreshed (not on every click). It falls down the whole page rather than
the screen, so it stays put when you scroll and catches up with you, passing behind cards, buttons and text.
It ends when the last piece reaches the footer (or after 90 seconds on very long pages). Visitors whose device
asks for reduced motion never see it, and turning the look off stops it.

The footer and envelope decorations are drawn as a few layers of different widths, so the leaf piles, snow
and icicles look scattered instead of repeating.

## Trying a theme

Run `bash tools/preview.sh` and open http://localhost:8811. A **Theme preview** picker sits in the bottom-left
corner (only on localhost): pick Plain, Fall, Winter, or "By today's date". You can also add `?season=winter`
to any address. The choice lasts until you close the tab.

## Making a new theme

1. Copy `fall/` to a new folder, say `spring/`, and rename every `html[data-season="fall"]` to `"spring"`.
2. Change the colors. Themes change the accents (buttons, links, highlights) and keep the site's own paper
   colors, so the page feels the same all year. Every token you set in the light block must also be set in
   the dark-mode block.
3. Add an entry to `seasons.yaml`.
4. `python tools/build_themes.py` checks it all and says plainly what to fix.

Rules the check enforces: every rule starts with `html[data-season="<name>"]` (so nothing leaks onto the plain
site), dates are `"MM-DD"` and can't overlap, text stays readable, and `--foot-bg` stays the same (the footer
is the page's clear end in every look).

Decorations should never take up space: the garland sits above the header and the little accent floats by
the hive logo, so nothing on the page moves when a theme turns on.
