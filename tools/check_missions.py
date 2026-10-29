"""Check the mission catalog for mistakes before committing.

    python tools/check_missions.py              # checks missions/
    python tools/check_missions.py other/folder
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from missions_lib import THEMES_REQUIRED, check_catalog, expired_cautions, load_catalog  # noqa: E402

folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "missions"
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
