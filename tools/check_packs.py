"""List pack folders that are missing pack.yaml (or have one with fields left out).

    python tools/check_packs.py               # report on missions/
    python tools/check_packs.py other/folder  # report on another catalog folder
    python tools/check_packs.py --strict      # also exit with an error if anything is found (for CI)

Every folder in missions/ is a pack, except general/ and folders starting with _ or .
Without pack.yaml a pack still loads, but shows its bare folder name ("Montana") instead of
"Amble Montana", with no description or icon.
"""
import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ("name", "region", "description", "icon")  # see SCHEMA.md


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=str(ROOT / "missions"))
    ap.add_argument("--strict", action="store_true", help="exit with an error if anything is found")
    args = ap.parse_args()

    root = Path(args.folder)
    if not root.is_dir():
        raise SystemExit(f"No folder at {root}")
    folders = sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_")) and p.name != "general")

    missing, incomplete = [], []
    for f in folders:
        count = sum(1 for m in f.glob("*.yaml") if m.name != "pack.yaml" and not m.name.startswith("_"))
        pack = f / "pack.yaml"
        if not pack.exists():
            missing.append((f.name, count))
            continue
        try:
            data = yaml.safe_load(pack.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            incomplete.append((f.name, ["isn't valid YAML (check indents and colons)"]))
            continue
        if not isinstance(data, dict):
            incomplete.append((f.name, ["should be 'key: value' lines"]))
            continue
        gaps = [k for k in FIELDS if not str(data.get(k) or "").strip()]
        if gaps:
            incomplete.append((f.name, [f"missing {', '.join(gaps)}"]))

    if missing:
        print(f"Missing pack.yaml ({len(missing)}):")
        for name, count in missing:
            label = name.replace("-", " ").title()
            print(f"  {name}/  ({count} mission{'' if count == 1 else 's'}) shows as \"{label}\" instead of \"Amble {label}\"")
    if incomplete:
        print(("\n" if missing else "") + f"pack.yaml needs fixing ({len(incomplete)}):")
        for name, problems in incomplete:
            print(f"  {name}/pack.yaml: {'; '.join(problems)}")
    if missing or incomplete:
        print("\nTo fix: copy pack.yaml from another pack folder, then edit name, region, description and icon.")
    else:
        print(f"All {len(folders)} packs have a complete pack.yaml.")
    sys.exit(1 if (args.strict and (missing or incomplete)) else 0)


if __name__ == "__main__":
    main()