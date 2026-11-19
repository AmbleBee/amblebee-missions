"""Mission Management ships on its own later (a zip people download to write their own missions), so it keeps its own
copies of a few files. This makes sure those copies never drift from the originals.

    python tools/check_copies.py

Exits with an error naming any copy that differs. To fix one, copy the original over it (or the other way round, if
the change was made in the copy on purpose).
"""
import filecmp
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MM = ROOT / "tools" / "mission_management"
FONTS = ["caveat-700.woff2", "fraunces.woff2", "nunito.woff2",
         "LICENSE-fontsource-caveat", "LICENSE-fontsource-variable-fraunces", "LICENSE-fontsource-variable-nunito"]
COPIES = [(ROOT / "missions" / "SCHEMA.md", MM / "starter" / "SCHEMA.md")]
COPIES += [(ROOT / "site" / "fonts" / f, MM / "fonts" / f) for f in FONTS]


def main():
    bad = []
    for original, copy in COPIES:
        if not copy.is_file() or not filecmp.cmp(original, copy, shallow=False):
            bad.append(f"{copy.relative_to(ROOT)} differs from {original.relative_to(ROOT)}")
    if bad:
        print("Mission Management's copies are out of step:\n  - " + "\n  - ".join(bad))
        sys.exit(1)
    print(f"Mission Management's {len(COPIES)} copies match their originals.")


if __name__ == "__main__":
    main()
