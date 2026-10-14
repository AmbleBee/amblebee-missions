# The AmbleBee Missions website

A one-page mission picker that GitHub builds from the `missions/` folder and hosts for free on
GitHub Pages: **https://amblebee.github.io/amblebee-missions/**

Every push to `main` re-checks the missions, rebuilds `catalog.json` and republishes the site, so
adding a mission file is all it takes to put it on the website (and on every Hive that checks for
updates, since the Hive downloads the same `catalog.json`).

## What's in here

| Path | What it is |
|---|---|
| `site/` | The website: `index.html`, `style.css`, `app.js`, `favicon.svg`. No frameworks, no trackers, no cookies. |
| `site/fonts/` | Fraunces, Nunito and Caveat, downloaded at build time (self-hosted, so nobody's browser talks to Google). |
| `tools/check_missions.py` | Checks every mission file. Runs on every push and pull request. |
| `tools/build_catalog.py` | Builds `catalog.json` from the mission files. |
| `tools/build_zips.py` | Builds `zips.json` (ZIP code → map point) from the Census file at build time. |
| `tools/fetch_fonts.sh` | Downloads the fonts (needs `npm`). |
| `tools/preview.sh` | Builds and serves the site on your laptop. |
| `.github/workflows/pages.yml` | The GitHub Action that does all of the above and publishes. |

## Turning it on (one time)

1. Copy `site/`, `tools/`, `.github/`, `.gitignore` and this file into the `amblebee-missions` repo.
   If that repo already has its own `missions/` folder, keep it (the `missions/` in this zip is
   test data). If the repo has an older workflow that also builds `catalog.json`, delete it so
   the two don't fight.
2. The repo has to be **public** (Pages is free on public repos only).
3. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Push to `main`. Watch it in the **Actions** tab; the deploy step prints the site's address.

## Before you announce it

- [ ] Fix the `# APPROX` coordinates (`grep -rn APPROX missions/`). They're close enough to test
      with but should sit on the parking lot, entrance or trailhead.
- [ ] Make the "Share a mission" form, then paste its link into `FORM_URL` at the top of
      `site/app.js`. Until then the button points people to GitHub instead.
- [ ] Open the site on your phone and roll a few missions.

## Previewing on your laptop

```bash
pip install pyyaml          # once
bash tools/preview.sh       # then open http://localhost:8811
```

Without `npm` the fonts are skipped and the page falls back to system fonts; everything else works.

## Privacy

- "Starting from" takes a ZIP code. The page downloads the whole US ZIP list (`zips.json`, built
  from the Census Bureau's public ZCTA file by `tools/build_zips.py`) and looks the ZIP up inside the
  browser, so the ZIP itself is never sent anywhere or stored. Distances are as the bee flies.
- The mi/km choice is remembered in the browser (localStorage), nothing else is.
- No analytics. GitHub Pages itself keeps standard server logs (IP addresses) like any web host.

## Linking to a mission

Every mission has its own link, e.g. `…/amblebee-missions/#mission=max/haystack-rock`. The
**Share** button on a mission copies it.
