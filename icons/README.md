# Icon pack

One shared set of icons for the website, and later the Hive and the AmbleBee.

```
icons/
  packs/   one icon per pack (pack.yaml `icon: mountain` -> icons/packs/mountain.svg)
```

Later folders: `gear/` for the Our gear page, `ui/` if the Hive needs interface icons.
Each folder is its own set: a pack icon is only looked up in `packs/`.

## Drawing a new icon

Copy any file in `packs/` and change the shapes inside. Keep the same style so they sit together,
and so they still read on the AmbleBee's black-and-white e-ink screen:

- `viewBox="0 0 24 24"`, keep everything inside about 2 to 22
- strokes only, `stroke="currentColor"`, width 2.2, round caps and joins (the root `<svg>` sets this)
- small solid dots are fine with `fill="currentColor" stroke="none"`; no gradients, images, text or colours
- simple shapes, no fine detail: check it at 18px (the size on a mission's source line)
- the file name is the icon name: lowercase letters, numbers and dashes (`covered-bridge.svg`)

Allowed shapes: `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `g`.
`python tools/build_icons.py` checks every file and stops with a plain message if one breaks a rule;
`python tools/check_missions.py` fails if a pack.yaml names an icon that isn't here.
