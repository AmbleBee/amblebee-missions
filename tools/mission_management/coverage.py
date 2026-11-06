"""Loads every pack and mission with its git dates, for the dashboard (scoring.py holds the balance targets).

Per pack the dashboard looks at:
    Setting   indoor vs outdoor ("either" counts half each way)
    Cost      cheap (free, $) vs pricier ($$, $$$)
    Mode      date vs adventure ("both" counts half each way)
    Themes    how many of the website's themes the pack uses, and whether one theme takes over

A pack is only "off" when a share falls outside its target band in scoring.yaml, not when it
isn't 50/50. Missions are mostly outdoors on purpose; the bands just catch the wild cases.
Packs with fewer than min_missions missions are shown but not ranked (too few to judge).

Dates: "edited" and "added" come from git history (the last and first commit that touched the
file). Outside git they fall back to the file's modified time; files you've changed but not
committed yet count as edited today.
"""
import datetime
import os
import subprocess
from pathlib import Path

from amble_checks import load_catalog, places_rule

def git_dates(missions_dir):
    """(repo_top, {path from repo top: (added, edited)}, note). Dates are YYYY-MM-DD."""
    try:
        top = subprocess.run(["git", "-C", str(missions_dir), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, check=True).stdout.strip()
        shallow = subprocess.run(["git", "-C", top, "rev-parse", "--is-shallow-repository"],
                                 capture_output=True, text=True).stdout.strip() == "true"
        log = subprocess.run(["git", "-C", top, "log", "--format=%x00%cs", "--name-only", "--no-renames",
                              "--", str(Path(missions_dir).resolve().relative_to(top))],
                             capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        return None, {}, "Not a git checkout, so dates are each file's modified time."
    dates, day = {}, None
    for line in log.splitlines():
        if line.startswith("\x00"):
            day = line[1:]
        elif line.strip() and day:
            added, edited = dates.get(line, (day, day))
            dates[line] = (day, edited)    # the log runs newest first: first seen = edited, last seen = added
    note = ("Shallow clone: git only knows the latest commit, so dates are mostly the same. "
            "Run `git fetch --unshallow` for real dates.") if shallow else ""
    return Path(top), dates, note


def uncommitted(top):
    """Mission files with changes git hasn't committed yet."""
    try:
        out = subprocess.run(["git", "-C", str(top), "status", "--porcelain", "--untracked-files=all", "--", "missions"],
                             capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return set()
    return {line[3:].strip().strip('"') for line in out.splitlines() if line.strip()}


def load(missions_dir):
    """(pack_names, rows, note): one row per mission with what the dashboard and list need."""
    _, packs, missions = load_catalog(missions_dir)
    top, dates, note = git_dates(missions_dir)
    dirty = uncommitted(top) if top else set()
    today = datetime.date.today().isoformat()
    rows = []
    for m in missions:
        rel = str(Path(m["file"]).resolve().relative_to(top)) if top else None
        added, edited = dates.get(rel, (None, None)) if rel else (None, None)
        if rel in dirty:
            edited, added = today, added or today
        if not edited:
            edited = added = datetime.date.fromtimestamp(os.path.getmtime(m["file"])).isoformat()
        rows.append({
            "id": m["id"], "pack": m["pack"], "number": m.get("number"), "name": m.get("name", m["id"]),
            "mode": m.get("mode"), "setting": m.get("setting"), "cost": m.get("cost"), "season": m.get("season"), "time": m.get("time_of_day"),
            "themes": list(m.get("themes") or []), "draft": bool(m.get("draft")),
            "checked": m.get("checked"), "added": added, "edited": edited, "uncommitted": rel in dirty,
        })
    info = {pid: {"name": p.get("name", pid), "region": p.get("region") or "", "description": p.get("description") or "",
                  "icon": p.get("icon") or "", "places": places_rule(pid, p), "count": p.get("count", 0),
                  "drafts": p.get("drafts", 0)}
            for pid, p in packs.items()}
    return info, rows, note
