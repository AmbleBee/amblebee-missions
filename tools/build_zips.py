"""Build zips.json: US ZIP code -> [lat, lon] for the website's "Starting from ZIP" box.

    python tools/build_zips.py --out _site/zips.json

Downloads the Census Bureau's ZCTA gazetteer (public domain) and keeps just the ZIP and its
center point, rounded to 2 decimals (about 1 km, plenty for "as the bee flies").
The whole file goes to the visitor's browser and the lookup happens there, so nobody's ZIP is
ever sent anywhere. Runs in the GitHub Action; a failed download only disables the ZIP box.
"""
import argparse
import io
import json
import sys
import urllib.request
import zipfile
from datetime import date

URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_zcta_national.zip"

# census.gov turns away Python's default user agent (HTTP 403), so look like a normal browser download.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "application/zip,application/octet-stream,*/*",
}


def parse(text):
    lines = text.splitlines()
    head = [c.strip().upper() for c in lines[0].split("\t")]
    i_zip, i_lat, i_lon = head.index("GEOID"), head.index("INTPTLAT"), head.index("INTPTLONG")
    out = {}
    for line in lines[1:]:
        cols = [c.strip() for c in line.split("\t")]
        if len(cols) <= max(i_zip, i_lat, i_lon) or not cols[i_zip]:
            continue
        out[cols[i_zip].zfill(5)] = [round(float(cols[i_lat]), 2), round(float(cols[i_lon]), 2)]
    return out


def download():
    year = date.today().year
    for y in range(year, year - 7, -1):  # newest file that exists
        try:
            req = urllib.request.Request(URL.format(y=y), headers=HEADERS)
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
        except Exception as e:  # noqa: BLE001
            print(f"  {y}: {e}", flush=True)
            continue
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next(n for n in z.namelist() if n.endswith(".txt"))
            return y, z.read(name).decode("utf-8", "replace")
    raise SystemExit("Couldn't download the Census ZIP file.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build/zips.json")
    ap.add_argument("--from-file", help="use a local gazetteer .txt instead of downloading")
    a = ap.parse_args()
    if a.from_file:
        year, text = "local", open(a.from_file, encoding="utf-8").read()
    else:
        year, text = download()
    zips = parse(text)
    if len(zips) < 1000:
        raise SystemExit(f"Only {len(zips)} ZIPs found; the file format may have changed.")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"source": f"US Census Bureau ZCTA gazetteer {year}", "zips": zips}, f, separators=(",", ":"))
    print(f"Wrote {a.out}: {len(zips)} ZIP codes ({year})")


if __name__ == "__main__":
    sys.exit(main())
