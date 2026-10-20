"""List skipped and repeated mission numbers in every pack.

    python tools/check_numbers.py               # report on missions/
    python tools/check_numbers.py other/folder  # report on another catalog folder
    python tools/check_numbers.py --strict      # also exit with an error if anything is found (for CI)

Numbers run 1, 2, 3... within each pack. A skipped number isn't always a mistake: SCHEMA.md says
a removed mission's number is never reused, so a gap can be on purpose. Repeated numbers are
always a mistake (two missions would both be "Mission 4 of 12").
"""
import argparse
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from missions_lib import load_catalog  # noqa: E402


def ranges(nums):
    """[3, 4, 5, 9] -> "3-5, 9" so long runs of gaps stay readable."""
    out, start, prev = [], None, None
    for n in nums:
        if start is None:
            start = prev = n
        elif n == prev + 1:
            prev = n
        else:
            out.append(f"{start}-{prev}" if prev > start else str(start))
            start = prev = n
    if start is not None:
        out.append(f"{start}-{prev}" if prev > start else str(start))
    return ", ".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=str(ROOT / "missions"))
    ap.add_argument("--strict", action="store_true", help="exit with an error if any gaps, repeats or bad numbers are found")
    args = ap.parse_args()

    try:
        info, packs, missions = load_catalog(args.folder)
    except ValueError as e:
        raise SystemExit(f"Couldn't read the missions: {e}")

    by_pack = defaultdict(list)
    for m in missions:
        by_pack[m["pack"]].append(m)

    found = 0
    for pid in sorted(by_pack):
        name = packs.get(pid, {}).get("name", pid)
        files_by_num, bad = defaultdict(list), []
        for m in by_pack[pid]:
            n = m.get("number")
            if isinstance(n, bool) or not isinstance(n, int) or n < 1:
                bad.append(f"{Path(m['file']).name} (number: {n!r})")
            else:
                files_by_num[n].append(Path(m["file"]).name)
        nums = sorted(files_by_num)
        top = nums[-1] if nums else 0
        skipped = [n for n in range(1, top + 1) if n not in files_by_num]
        repeats = {n: f for n, f in files_by_num.items() if len(f) > 1}

        if not (skipped or repeats or bad):
            continue
        found += 1
        count = len(by_pack[pid])
        print(f"\n{name}  ({pid}/, {count} mission{'' if count == 1 else 's'}, highest number {top})")
        if skipped:
            print(f"  skipped: {ranges(skipped)}")
        for n in sorted(repeats):
            print(f"  repeated: {n} is used by {', '.join(sorted(repeats[n]))}")
        for b in bad:
            print(f"  not a whole number 1 or higher: {b}")
        print(f"  next free number: {top + 1}")

    total = len(by_pack)
    if found:
        print(f"\n{found} of {total} packs have skipped, repeated or bad numbers.")
        print("Skipped numbers can be on purpose (a removed mission's number is never reused). Repeats are always a mistake.")
    else:
        print(f"All {total} packs are numbered 1 to N with nothing skipped or repeated.")
    sys.exit(1 if (found and args.strict) else 0)


if __name__ == "__main__":
    main()