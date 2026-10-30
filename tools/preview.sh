#!/usr/bin/env bash
# Builds the site the same way GitHub does and serves it at http://localhost:8811
#   bash tools/preview.sh            (fonts are fetched once if npm is available)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/check_missions.py
if [ ! -f site/fonts/fraunces.woff2 ] && command -v npm >/dev/null; then bash tools/fetch_fonts.sh; fi
rm -rf _site && cp -r site _site
python3 tools/build_catalog.py --out _site/catalog.json
python3 tools/build_icons.py --out _site/icons.json
python3 tools/build_pages.py --out _site
[ -f tools/build_roadmap.py ] && python3 tools/build_roadmap.py --out _site/roadmap.json
echo "Open http://localhost:8811  (Ctrl+C to stop)"
cd _site && python3 -m http.server 8811
