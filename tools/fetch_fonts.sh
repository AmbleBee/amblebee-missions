#!/usr/bin/env bash
# Downloads the site's three fonts from npm (Fontsource packages, all SIL Open Font License)
# into site/fonts/, so visitors never load anything from Google.
#   bash tools/fetch_fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
( cd "$work" && npm pack --silent @fontsource-variable/fraunces @fontsource-variable/nunito @fontsource/caveat >/dev/null )
for t in "$work"/*.tgz; do mkdir -p "$work/x" && tar -xzf "$t" -C "$work/x" && mv "$work/x/package" "$work/$(basename "$t" .tgz)" && rm -rf "$work/x"; done

pick() {  # first file that exists
  for f in "$@"; do if [ -f "$f" ]; then echo "$f"; return; fi; done
  echo "Missing font file; looked for: $*" >&2; exit 1
}
F="$(ls -d "$work"/fontsource-variable-fraunces-*)/files"
N="$(ls -d "$work"/fontsource-variable-nunito-*)/files"
C="$(ls -d "$work"/fontsource-caveat-*)/files"
cp "$(pick "$F/fraunces-latin-full-normal.woff2" "$F/fraunces-latin-wght-normal.woff2")" site/fonts/fraunces.woff2
cp "$(pick "$N/nunito-latin-wght-normal.woff2" "$N/nunito-latin-standard-normal.woff2")" site/fonts/nunito.woff2
cp "$(pick "$C/caveat-latin-700-normal.woff2")" site/fonts/caveat-700.woff2
for p in "$work"/fontsource-variable-fraunces-* "$work"/fontsource-variable-nunito-* "$work"/fontsource-caveat-*; do
  cp "$p/LICENSE" "site/fonts/LICENSE-$(basename "$p" | sed 's/-[0-9.]*$//')" 2>/dev/null || true
done
ls -la site/fonts
