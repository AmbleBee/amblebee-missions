#!/usr/bin/env python3
"""Suggests themes for missions from their existing free-form tags.

    python tools/suggest_themes.py                 show suggestions for missions that have no themes yet
    python tools/suggest_themes.py --pack oregon   only one pack
    python tools/suggest_themes.py --write         add a `themes: [...]` line to those mission files

Only missions without a themes line are touched, so it never overwrites themes you've picked by hand.
The line goes just above `tags:`; nothing else in the file changes (comments and order stay as they are).
Suggestions are a starting point: read them over when you verify each mission, and add or drop
themes the tags didn't catch. Run python tools/check_missions.py afterwards.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "mission_management"))
from missions_lib import THEMES, load_catalog  # noqa: E402

from theme_hints import TAGS_FOR, suggest  # noqa: E402  (the word list lives with the mission manager)


def add_line(path, themes):
    text = Path(path).read_text(encoding="utf-8")
    line = f"themes: [{', '.join(themes)}]\n"
    for key in ("tags", "credit"):
        mt = re.search(rf"^{key}:", text, re.M)
        if mt:
            text = text[:mt.start()] + line + text[mt.start():]
            break
    else:
        text = text.rstrip("\n") + "\n" + line
    Path(path).write_text(text, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--missions", default=str(ROOT / "missions"))
    ap.add_argument("--pack", help="only this pack folder (oregon, anywhere ...)")
    ap.add_argument("--write", action="store_true", help="add the themes line to the files")
    args = ap.parse_args()
    bad = sorted({t for t in TAGS_FOR if t not in THEMES})
    if bad:
        raise SystemExit(f"TAGS_FOR has themes that aren't in missions_lib.THEMES: {bad}")

    folder = Path(args.missions)
    _, _, missions = load_catalog(folder)
    todo = [m for m in missions if "themes" not in m and (not args.pack or m["pack"] == args.pack)]
    done, empty = 0, []
    for m in sorted(todo, key=lambda m: (m["pack"], m["number"] if isinstance(m["number"], int) else 0)):
        rel = Path(m["file"]).relative_to(folder)
        themes = suggest(m)
        if not themes:
            empty.append(rel)
            continue
        print(f"{rel}: themes: [{', '.join(themes)}]")
        if args.write:
            add_line(m["file"], themes)
            done += 1
    print(f"\n{len(todo) - len(empty)} of {len(todo)} missions without themes got a suggestion"
          + (f"; wrote {done} files" if args.write else " (nothing written; add --write to save them)"))
    if empty:
        print(f"No suggestion for {len(empty)} (none of their tags map to a theme); pick by hand:")
        for rel in empty:
            print(f"  - {rel}")


if __name__ == "__main__":
    main()
