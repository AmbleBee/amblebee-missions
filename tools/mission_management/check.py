"""Check a mission catalog for mistakes: the same rules the mission manager runs on every save.

    python check.py                  # the missions/ folder here (or next to this script's folder)
    python check.py path/to/missions

Exits with an error when anything fails, so it can run on every push (the manager's setup adds that).
Needs only PyYAML and amble_checks.py, which sits next to this file.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from amble_checks import (PIN_NOTES_BLOCK_LIVE, THEMES_REQUIRED, check_catalog, expired_cautions,  # noqa: E402
                          load_catalog, pin_notes)


def find_missions():
    """The missions/ folder to check: here, or next to the folder this script is in (tools/ in a pack repo)."""
    for base in (Path.cwd(), HERE.parent, HERE.parent.parent):
        if (base / "missions").is_dir():
            return base / "missions"
    return Path.cwd() / "missions"


folder = Path(sys.argv[1]) if len(sys.argv) > 1 else find_missions()
problems = check_catalog(folder)
if problems:
    print(f"{len(problems)} problem(s) in {folder}:")
    for p in problems:
        print("  -", p)
    sys.exit(1)
info, packs, missions = load_catalog(folder)
drafts = sum(1 for m in missions if m.get("draft"))
print(f"OK: {info['name']} ({info['source_id']}), {len(missions) - drafts} missions on the site"
      + (f", {drafts} drafts hidden until verified" if drafts else ""))
for pid, p in packs.items():
    print(f"  {p.get('name', pid)}: {p['count']}" + (f" (+{p['drafts']} drafts)" if p.get("drafts") else ""))
# reminders only (never a failure): cautions past their caution_until date are already hidden on the site
old = expired_cautions(missions)
if old:
    print(f"\nNote: {len(old)} caution(s) have ended; delete the caution and caution_until lines:")
    for m, d in old:
        print(f"  - {Path(m['file']).relative_to(folder)} (ended {d.isoformat()})")
# themes are optional for now; this shows how far along the backfill is (never a failure)
if not THEMES_REQUIRED:
    missing = [m for m in missions if not m.get("themes")]
    if missing:
        live = sum(1 for m in missing if not m.get("draft"))
        print(f"\nNote: {len(missing)} mission(s) have no themes yet ({live} of them on the site). "
              "python tools/suggest_themes.py suggests some from their tags.")
# live missions whose file still says the pin needs checking (a reminder until PIN_NOTES_BLOCK_LIVE is on)
if not PIN_NOTES_BLOCK_LIVE:
    noted = [m for m in missions if not m.get("draft") and pin_notes(Path(m["file"]).read_text(encoding="utf-8"))]
    if noted:
        print(f"\nNote: {len(noted)} live mission(s) still have a \"check the pin before publishing\" note. Check each pin, "
              "delete the note, then set PIN_NOTES_BLOCK_LIVE = True in tools/missions_lib.py:")
        for m in noted:
            print(f"  - {Path(m['file']).relative_to(folder)}")
