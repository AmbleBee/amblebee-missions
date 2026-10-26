"""Check the icon pack and build icons.json (what the website reads) from icons/.

    python tools/build_icons.py                         # just check icons/
    python tools/build_icons.py --out _site/icons.json

icons.json looks like {"packs": {"mountain": "<path d=.../>", ...}, "site": {...}}: the inside of each SVG,
ready to drop into the site's <svg> wrapper (which sets the 24x24 box, stroke and colour).
Only plain shapes are allowed, so nothing in an icon file can run code on the website.
"""
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETS = ("packs", "site")  # add "gear" when that folder exists
NS = "{http://www.w3.org/2000/svg}"
TAGS = {"path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g"}
ATTRS = {"d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points",
         "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
         "fill-opacity", "stroke-opacity", "stroke-dasharray"}
COLOR_OK = {"none", "currentColor"}
SKIP = {"metadata", "title", "desc"}  # editor/provenance info: never drawn, so it's left out instead of failing
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SAFE_VALUE = re.compile(r"^[\w\s.,#%()\-+]*$")


def tag(el):
    return el.tag.replace(NS, "")


def check_el(el, where, problems):
    t = tag(el)
    if t not in TAGS:
        problems.append(f"{where}: <{t}> isn't allowed (use path, circle, ellipse, rect, line, polyline, polygon or g)")
        return
    for k, v in el.attrib.items():
        if k not in ATTRS:
            problems.append(f"{where}: <{t}> has '{k}', which isn't allowed")
        elif k in ("fill", "stroke") and v not in COLOR_OK:
            problems.append(f"{where}: {k}=\"{v}\" should be none or currentColor, so the icon takes the page's colour")
        elif "url(" in v or "script" in v.lower() or not SAFE_VALUE.match(v):
            problems.append(f"{where}: {k}=\"{v}\" has characters that aren't allowed")
    if (el.text or "").strip():
        problems.append(f"{where}: <{t}> has text inside it; icons are shapes only")
    for child in el:
        check_el(child, where, problems)


def inner(el):
    """Serialize the children without the svg namespace, attributes in a stable order."""
    def one(e):
        attrs = "".join(f' {k}="{v}"' for k, v in e.attrib.items())
        kids = "".join(one(c) for c in e)
        return f"<{tag(e)}{attrs}/>" if not kids else f"<{tag(e)}{attrs}>{kids}</{tag(e)}>"
    return "".join(one(c) for c in el if tag(c) not in SKIP)


def load(root=ROOT / "icons"):
    """Returns ({set: {name: markup}}, problems)."""
    out, problems = {}, []
    for s in SETS:
        folder = Path(root) / s
        out[s] = {}
        if not folder.is_dir():
            continue
        for f in sorted(folder.glob("*.svg")):
            where = f"icons/{s}/{f.name}"
            if not NAME_RE.match(f.stem):
                problems.append(f"{where}: file name should be lowercase letters, numbers and dashes")
            try:
                svg = ET.parse(f).getroot()
            except ET.ParseError as e:
                problems.append(f"{where}: not a valid SVG ({e})")
                continue
            if tag(svg) != "svg":
                problems.append(f"{where}: should start with <svg>")
                continue
            if svg.get("viewBox") != "0 0 24 24":
                problems.append(f'{where}: needs viewBox="0 0 24 24"')
            shapes = [c for c in svg if tag(c) not in SKIP]
            if not shapes:
                problems.append(f"{where}: is empty")
            for child in shapes:
                check_el(child, where, problems)
            out[s][f.stem] = inner(svg)
    return out, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(ROOT / "icons"))
    ap.add_argument("--out", help="where to write icons.json (leave out to only check)")
    args = ap.parse_args()
    icons, problems = load(args.src)
    if problems:
        raise SystemExit("Not building the icons, fix these first:\n  - " + "\n  - ".join(problems))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(icons, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    counts = ", ".join(f"{len(v)} {k}" for k, v in icons.items())
    print(f"Icons OK: {counts}" + (f" -> {args.out}" if args.out else ""))


if __name__ == "__main__":
    sys.exit(main())
