"""Build roadmap.json (what roadmap.html reads) from roadmap.yaml at the repo root.

    python tools/build_roadmap.py                       # just check roadmap.yaml
    python tools/build_roadmap.py --out _site/roadmap.json

Never edit roadmap.json by hand: edit roadmap.yaml. The GitHub Action runs this on every push,
and a mistake in roadmap.yaml stops the build with a message saying which entry and what's wrong.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

from missions_lib import live_stats, load_catalog

ROOT = Path(__file__).resolve().parent.parent
STATUSES = ("doing", "next", "later", "done")
KEYS = {"title", "status", "date", "when", "tag", "summary", "items", "progress"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# progress: 140/415  or  140/415 places pinned  (done / total, then an optional label)
PROGRESS_RE = re.compile(r"^\s*(\d+)\s*/\s*(\d+)\s*(.*?)\s*$")


def as_date(value):
    """YAML turns 2026-10-19 into a date already; a quoted "2026-10-19" stays a string."""
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str) and DATE_RE.match(value.strip()):
        return dt.date.fromisoformat(value.strip())
    raise ValueError


def check(entries, stats):
    problems, clean = [], []
    if not isinstance(entries, list):
        return ["roadmap.yaml should be a list of entries, each starting with '- title:'"], []
    for i, e in enumerate(entries, 1):
        name = f"entry {i}" + (f' ("{e.get("title")}")' if isinstance(e, dict) and e.get("title") else "")
        if not isinstance(e, dict):
            problems.append(f"{name}: should be a set of 'key: value' lines")
            continue
        for k in sorted(set(e) - KEYS):
            hint = {"type": "status", "notes": "summary", "bullets": "items", "category": "tag", "tags": "tag"}.get(k)
            problems.append(f"{name}: unknown key '{k}'" + (f" (did you mean '{hint}'?)" if hint else ""))
        if not str(e.get("title") or "").strip():
            problems.append(f"{name}: needs a title")
        status = str(e.get("status") or "").strip().lower()
        if status not in STATUSES:
            problems.append(f"{name}: status must be one of {', '.join(STATUSES)} (got '{e.get('status')}')")
        date = None
        if e.get("date") is not None:
            try:
                date = as_date(e["date"])
            except ValueError:
                problems.append(f"{name}: date must look like 2026-10-19 (got '{e['date']}')")
        elif status == "done":
            problems.append(f"{name}: done entries need a date, like 'date: 2026-10-19'")
        progress = None
        if e.get("progress") not in (None, ""):
            live = str(e["progress"]).strip().lower() == "live"   # counted from the mission files
            text = f"{stats['live']}/{stats['live'] + stats['drafts']}" if live else str(e["progress"])
            m = PROGRESS_RE.match(text)
            if not m:
                problems.append(f"{name}: progress should look like 140/415 (done/total), "
                                f"optionally followed by a label like 140/415 places pinned (got '{e['progress']}')")
            else:
                done_n, total_n, label = int(m.group(1)), int(m.group(2)), m.group(3)
                if total_n == 0:
                    problems.append(f"{name}: progress total can't be 0 (got '{e['progress']}')")
                elif done_n > total_n:
                    problems.append(f"{name}: progress has more done than the total ({done_n}/{total_n})")
                else:
                    # rounded down, so it never says 100% until the last one is done
                    progress = {"done": done_n, "total": total_n, "percent": done_n * 100 // total_n,
                                "label": label or None}
        items = e.get("items") or []
        if not isinstance(items, list) or not all(isinstance(x, (str, int, float)) for x in items):
            problems.append(f"{name}: items should be a list of '- text' lines")
            items = []
        clean.append({
            "title": str(e.get("title") or "").strip(),
            "status": status,
            "date": date.isoformat() if date else None,
            "when": str(e["when"]).strip() if e.get("when") else None,
            "tag": str(e["tag"]).strip().lower() if e.get("tag") else None,
            "summary": str(e["summary"]).strip() if e.get("summary") else None,
            "items": [str(x).strip() for x in items],
            "progress": progress,
        })
    return problems, clean


def build(path):
    try:
        entries = yaml.safe_load(path.read_text(encoding="utf-8")) or []
    except yaml.YAMLError as err:
        raise SystemExit(f"roadmap.yaml isn't valid YAML (check indents and colons):\n  {err}")
    _, packs, missions = load_catalog(ROOT / "missions")
    stats = live_stats(packs, missions)
    problems, clean = check(entries, stats)
    if problems:
        raise SystemExit("Not building the roadmap, fix these in roadmap.yaml first:\n  - " + "\n  - ".join(problems))
    upcoming = [e for e in clean if e["status"] != "done"]
    # time runs one way down the page: someday at the top, then next, then doing (right above "today")
    upcoming.sort(key=lambda e: ("later", "next", "doing").index(e["status"]))  # stable: file order within a status
    done = sorted((e for e in clean if e["status"] == "done"), key=lambda e: e["date"], reverse=True)
    return {"upcoming": upcoming, "done": done, "stats": stats,
            "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=str(ROOT / "roadmap.yaml"))
    ap.add_argument("--out", help="where to write roadmap.json (leave out to only check)")
    args = ap.parse_args()
    data = build(Path(args.src))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Roadmap OK: {len(data['upcoming'])} coming up, {len(data['done'])} done"
          + (f" -> {args.out}" if args.out else ""))


if __name__ == "__main__":
    main()
