# amblebee-missions
Date and adventure missions for the AmbleBee camera. One file per mission, grouped into Amble packs by state. Submit your own ideas!

The website is at [amblebee.com](https://amblebee.com). It's built from this repo by GitHub Actions on every push to `main`.

## What's where

| Folder | What it holds |
|---|---|
| `missions/` | One YAML file per mission, in a folder per pack. Format: [SCHEMA.md](missions/SCHEMA.md) |
| `site/` | The website: home page, roadmap page, styles, and the scripts in `site/js/` |
| `pages/` | The words on the Safety, Privacy, Contact and 404 pages |
| `icons/` | Pack and site icons ([how to add one](icons/README.md)) |
| `data/` | ZIP code and city lookups, refreshed with `python tools/build_zips.py` and `python tools/build_cities.py` |
| `tools/` | Checks and build scripts |
| `roadmap.yaml` | The bee trail page. Edit it, push, done |

## Working on it

```bash
pip install pyyaml==6.0.1
bash tools/preview.sh
```

That checks everything, builds the site and serves it at http://localhost:8811.

To run the browser tests against a built `_site`:

```bash
pip install playwright==1.64.1
python -m playwright install chromium
python tools/smoke_test.py
```

The same tests run on every push and pull request, in Chromium, Firefox and WebKit (Safari's engine). A failure in Chromium or Firefox stops the deploy; WebKit only reports for now. To try another engine here, install it and run `SMOKE_ENGINE=firefox python tools/smoke_test.py`.

Want to add a mission? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The missions in `missions/` are shared under [CC BY-SA 4.0](LICENSE). The fonts in `site/fonts/` have their own licenses, next to them. The ZIP and city data comes from the US Census Bureau and is public domain. The license doesn't cover the website code or icons.
