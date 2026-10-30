"""Refresh data/cities.json: US city and town -> [lat, lon] for the website's "ZIP code or city" box.

    python tools/build_cities.py
    python tools/build_cities.py --from-file 2026_Gaz_place_national.txt --pop-file sub-est2025.csv

Downloads the Census Bureau's places gazetteer and city population estimates (both public domain), and keeps
each place's name, state and center point, most people first, so a name shared by several towns offers the
likeliest one first. Unincorporated places have no estimate, so their land area stands in for one. The whole
file goes to the visitor's browser the first time they type a city, and the lookup happens there, so nothing is
ever sent anywhere. Census data changes about once a year: run this now and then and commit the result.
"""
import argparse
import csv
import io
import json
import re
import urllib.request
import zipfile
from datetime import date

URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{y}_Gazetteer/{y}_Gaz_place_national.zip"
POP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-{y}/cities/totals/sub-est{y}.csv"
PEOPLE_PER_KM2 = 500  # a rough guess for places with no population estimate
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
# "Portland city" -> "Portland": the kind of place comes after the name
KIND = re.compile(r"\s+(CDP|city and borough|consolidated government|metropolitan government|unified government|"
                  r"urban county|corporation|city|town|village|borough|municipality)\b.*$")
# the names people actually type for places the Census calls something else
ALSO_KNOWN = {"Nashville-Davidson": "Nashville", "Urban Honolulu": "Honolulu", "Louisville/Jefferson County": "Louisville",
              "Lexington-Fayette": "Lexington", "Augusta-Richmond County": "Augusta", "Athens-Clarke County": "Athens",
              "Boise City": "Boise"}


def population(text):
    """{place id: people} for cities, and {(state id, name): people} for New England towns, which the gazetteer lists by name."""
    reader = csv.DictReader(io.StringIO(text))
    column = max(c for c in reader.fieldnames if c.startswith("POPESTIMATE"))
    places, towns = {}, {}
    for r in reader:
        people = int(r[column])
        if r["SUMLEV"] in ("162", "170", "172"):
            places[r["STATE"] + r["PLACE"]] = people
        elif r["SUMLEV"] == "061":
            key = (r["STATE"], KIND.sub("", r["NAME"]))
            towns[key] = max(people, towns.get(key, 0))
    return places, towns


def parse(text, people):
    places, towns = people
    lines = text.lstrip("﻿").splitlines()
    head = [c.strip() for c in lines[0].split("|")]
    at = {name: head.index(name) for name in ("USPS", "GEOID", "NAME", "ALAND", "INTPTLAT", "INTPTLONG")}
    rows = []
    for line in lines[1:]:
        c = [v.strip() for v in line.split("|")]
        if len(c) < len(head) or c[at["USPS"]] == "PR":
            continue
        name = KIND.sub("", c[at["NAME"]])
        geoid = c[at["GEOID"]]
        size = places.get(geoid) or towns.get((geoid[:2], name)) or int(c[at["ALAND"]]) / 1e6 * PEOPLE_PER_KM2
        name = ALSO_KNOWN.get(name, name)
        rows.append((size, name, c[at["USPS"]], round(float(c[at["INTPTLAT"]]), 2), round(float(c[at["INTPTLONG"]]), 2)))
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


def download_population():
    year = date.today().year
    for y in range(year, year - 7, -1):  # newest file that exists
        try:
            with urllib.request.urlopen(urllib.request.Request(POP_URL.format(y=y), headers=HEADERS), timeout=90) as r:
                return y, r.read().decode("latin-1")
        except Exception as e:  # noqa: BLE001
            print(f"  {y}: {e}", flush=True)
    raise SystemExit("Couldn't download the Census population file.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="data/cities.json")
    ap.add_argument("--from-file", help="use a local gazetteer .txt instead of downloading")
    ap.add_argument("--pop-file", help="use a local sub-est .csv instead of downloading")
    ap.add_argument("--year", default="local", help="the file's year, for --from-file and --pop-file")
    a = ap.parse_args()
    if a.from_file:
        year, text = a.year, open(a.from_file, encoding="utf-8").read()
    else:
        year, text = download()
    if a.pop_file:
        pop_year, pop_text = a.year, open(a.pop_file, encoding="latin-1").read()
    else:
        pop_year, pop_text = download_population()
    cities = parse(text, population(pop_text))
    if len(cities) < 10000:
        raise SystemExit(f"Only {len(cities)} places found; the file format may have changed.")
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump({"source": f"US Census Bureau places gazetteer {year}, population estimates {pop_year}", "cities": cities}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote {a.out}: {len(cities)} places ({year})")


if __name__ == "__main__":
    main()
