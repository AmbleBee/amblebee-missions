"""Refresh data/cities.json: US city and town -> [lat, lon] for the website's "ZIP code or city" box.

    python tools/build_cities.py
    python tools/build_cities.py --from-file 2026_Gaz_place_national.txt

Downloads the Census Bureau's places gazetteer (public domain), keeps each place's name, state and center
point, biggest first, so a name shared by several towns offers the biggest one first. The whole file goes to the
visitor's browser the first time they type a city, and the lookup happens there, so nothing is ever sent
anywhere. Census data changes about once a year: run this now and then and commit the result.
"""
import argparse
import io
import json
import re
import urllib.request
import zipfile
from datetime import date

URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_place_national.zip"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
# "Portland city" -> "Portland": the kind of place comes after the name
KIND = re.compile(r"\s+(CDP|city and borough|consolidated government|metropolitan government|unified government|"
                  r"urban county|corporation|city|town|village|borough|municipality)\b.*$")
# the names people actually type for places the Census calls something else
ALSO_KNOWN = {"Nashville-Davidson": "Nashville", "Urban Honolulu": "Honolulu", "Louisville/Jefferson County": "Louisville",
              "Lexington-Fayette": "Lexington", "Augusta-Richmond County": "Augusta", "Athens-Clarke County": "Athens",
              "Boise City": "Boise"}


def parse(text):
    lines = text.lstrip("﻿").splitlines()
    head = [c.strip() for c in lines[0].split("|")]
    at = {name: head.index(name) for name in ("USPS", "NAME", "ALAND", "INTPTLAT", "INTPTLONG")}
    rows = []
    for line in lines[1:]:
        c = [v.strip() for v in line.split("|")]
        if len(c) < len(head) or c[at["USPS"]] == "PR":
            continue
        name = KIND.sub("", c[at["NAME"]])
        name = ALSO_KNOWN.get(name, name)
        rows.append((int(c[at["ALAND"]]), name, c[at["USPS"]], round(float(c[at["INTPTLAT"]]), 2), round(float(c[at["INTPTLONG"]]), 2)))
    rows.sort(key=lambda r: (-r[0], r[1]))
    seen, out = set(), []
    for _, name, state, lat, lon in rows:
        if (name, state) not in seen:
            seen.add((name, state))
            out.append([name, state, lat, lon])
    return out


def download():
    year = date.today().year
    for y in range(year, year - 7, -1):  # newest file that exists
        try:
            with urllib.request.urlopen(urllib.request.Request(URL.format(y=y), headers=HEADERS), timeout=90) as r:
                data = r.read()
        except Exception as e:  # noqa: BLE001
            print(f"  {y}: {e}", flush=True)
            continue
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next(n for n in z.namelist() if n.endswith(".txt"))
            return y, z.read(name).decode("utf-8-sig", "replace")
    raise SystemExit("Couldn't download the Census places file.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data/cities.json")
    ap.add_argument("--from-file", help="use a local gazetteer .txt instead of downloading")
    ap.add_argument("--year", default="local", help="the file's year, for --from-file")
    a = ap.parse_args()
    if a.from_file:
        year, text = a.year, open(a.from_file, encoding="utf-8").read()
    else:
        year, text = download()
    cities = parse(text)
    if len(cities) < 10000:
        raise SystemExit(f"Only {len(cities)} places found; the file format may have changed.")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"source": f"US Census Bureau places gazetteer {year}", "cities": cities}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {a.out}: {len(cities)} places ({year})")


if __name__ == "__main__":
    main()
