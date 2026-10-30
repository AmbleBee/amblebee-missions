"""Build catalog.json from the missions/ folder (the one file the Hive downloads).

    python tools/build_catalog.py                       # writes build/catalog.json
    python tools/build_catalog.py --out _site/catalog.json

Never edit catalog.json by hand: edit the mission files and rebuild (the GitHub Action does
this on every push). Refuses to build if tools/check_missions.py finds problems.
"""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from missions_lib import THEMES, check_catalog, live_stats, load_catalog  # noqa: E402

PRIVATE_KEYS = {"file"}  # local paths never go into the published file


def build(folder):
    problems = check_catalog(folder)
    if problems:
        raise SystemExit("Not building, fix these first:\n  - " + "\n  - ".join(problems))
    info, packs, missions = load_catalog(folder)
    stats = live_stats(packs, missions)
    # draft missions (draft: true) are left out until they're verified
    out_missions = [{k: v for k, v in m.items() if k not in PRIVATE_KEYS and k != "draft"}
                    for m in sorted(missions, key=lambda m: (m["pack"] != "general", m["pack"], m["number"]))
                    if not m.get("draft")]
    packs = {pid: {k: v for k, v in p.items() if k != "drafts"} for pid, p in packs.items() if p["count"]}
    body = {
        "schema_version": info["schema_version"],
        "source": {k: info.get(k) for k in ("name", "source_id", "author", "updated")},
        "stats": stats,
        "packs": list(packs.values()),
        # the theme list (filter chips): id + label, in display order; missions list theirs under "themes"
        "themes": [{"id": t, "label": label} for t, label in THEMES.items()],
        "missions": out_missions,
    }
    # content hash: lets the Hive's "Check for updates" tell instantly whether anything changed
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
    return {**body, "content_hash": digest,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--missions", default=str(ROOT / "missions"))
    ap.add_argument("--out", default=str(ROOT / "build" / "catalog.json"))
    args = ap.parse_args()
    catalog = build(Path(args.missions))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    print(f"Built {out}: {len(catalog['missions'])} missions in {len(catalog['packs'])} packs "
          f"(hash {catalog['content_hash'][:12]})")


if __name__ == "__main__":
    main()
