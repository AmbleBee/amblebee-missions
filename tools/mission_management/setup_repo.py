"""Zero to hero: turns an empty folder (or a half-finished pack repo) into a working one, and adds packs.

    status(root)             what the repo has, what's missing, and whether its copy of the checker is current
    apply(root, info)        creates only the missing files; never overwrites anything
    update_checker(root)     replaces the repo's tools/amble_checks.py with the manager's newer copy (asked first)
    create_pack(root, data)  a new pack folder with its pack.yaml

A pack repo looks like this (missions/SCHEMA.md has the fields):
    missions/catalog.yaml               the collection: name, permanent source id, author
    missions/<pack>/pack.yaml           one folder per pack
    missions/<pack>/<mission>.yaml      one file per mission
    tools/check_missions.py, tools/amble_checks.py    the checker, so it runs without the manager
    .github/workflows/check-missions.yml               runs the checker on every push
"""
import re
from pathlib import Path

import yaml

import amble_checks as lib
from writer import scalar

HERE = Path(__file__).resolve().parent
STARTER = HERE / "starter"
VERSION_RE = re.compile(r"^CHECKER_VERSION\s*=\s*(\d+)", re.M)
CATALOG_FIELDS = {"name": 60, "source_id": 30, "author": 60}


def manager_inside(root):
    """True when this manager is part of the repo itself (AmbleBee's own repo), so the repo already has the checker."""
    try:
        HERE.relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def _workflow_runs_checker(root):
    wf = Path(root) / ".github" / "workflows"
    if not wf.is_dir():
        return False
    return any("check_missions.py" in f.read_text(encoding="utf-8", errors="replace")
               for f in wf.glob("*.y*ml"))


def plan(root):
    """[{path, what}] for every part of a pack repo that's missing."""
    root = Path(root)
    items = []

    def need(rel, what, when=True):
        if when and not (root / rel).exists():
            items.append({"path": rel, "what": what})

    need("missions/catalog.yaml", "Your collection: its name, a permanent short id, and who maintains it")
    need("missions/SCHEMA.md", "The field reference: every mission field and what it means")
    need("missions/_template.yaml", "A commented mission template, for writing missions by hand")
    inside = manager_inside(root)
    need("tools/amble_checks.py", "The mission checker (the same rules the manager uses)", not inside)
    need("tools/check_missions.py", "Runs the checker: python tools/check_missions.py", not inside)
    if not _workflow_runs_checker(root):
        need(".github/workflows/check-missions.yml", "Runs the checker on GitHub after every push")
    need("README.md", "A short note about the repo for anyone who finds it on GitHub")
    if not (root / ".gitignore").exists():
        items.append({"path": ".gitignore", "what": "Keeps everything but the missions off GitHub: your ideas, releases, "
                                                    "settings and the mission manager itself"})
    elif missing_ignores(root):
        items.append({"path": ".gitignore", "what": f"Add {', '.join(missing_ignores(root))} so they stay on this computer "
                                                    "(your existing lines are kept)", "append": True})
    return items


def missing_ignores(root):
    """Lines a pack repo's .gitignore should have so private things never get pushed. The manager's own folder is
    only ignored when it isn't part of the repo (AmbleBee's own repo keeps it, so it's shared)."""
    want = ["mission-ideas.yaml", "releases/"]
    if not manager_inside(root):
        want += ["mission_management/", "scoring.yaml"]
    gi = Path(root) / ".gitignore"
    have = {l.strip().lstrip("/") for l in gi.read_text(encoding="utf-8", errors="replace").splitlines()} if gi.exists() else set()
    return [w for w in want if w not in have and w.rstrip("/") not in have]


def checker_info(root):
    """The repo's checker version against the manager's. outdated: the repo's copy is older."""
    root = Path(root)
    if manager_inside(root):
        return {"repo": lib.CHECKER_VERSION, "manager": lib.CHECKER_VERSION, "outdated": False, "shared": True}
    f = root / "tools" / "amble_checks.py"
    if not f.exists():
        return {"repo": None, "manager": lib.CHECKER_VERSION, "outdated": False, "shared": False}
    m = VERSION_RE.search(f.read_text(encoding="utf-8", errors="replace"))
    repo = int(m.group(1)) if m else 1
    return {"repo": repo, "manager": lib.CHECKER_VERSION, "outdated": repo < lib.CHECKER_VERSION, "shared": False}


def packs_without_yaml(root):
    """Pack folders that have missions but no pack.yaml (the New pack form can adopt them)."""
    missions = Path(root) / "missions"
    if not missions.is_dir():
        return []
    return sorted(f.name for f in missions.iterdir() if f.is_dir() and not f.name.startswith((".", "_"))
                  and f.name != "general" and not (f / "pack.yaml").exists())


def status(root):
    root = Path(root)
    return {"root": str(root), "ready": (root / "missions" / "catalog.yaml").exists(),
            "missing": plan(root), "checker": checker_info(root), "managerInside": manager_inside(root),
            "noPackYaml": packs_without_yaml(root)}


def _catalog_text(info):
    problems = []
    clean = {}
    for key, limit in CATALOG_FIELDS.items():
        v = " ".join(str(info.get(key) or "").split())
        if not v:
            problems.append(f"{key.replace('_', ' ')} is needed")
        elif len(v) > limit:
            problems.append(f"{key.replace('_', ' ')} is {len(v)} characters; keep it to {limit}")
        clean[key] = v
    if clean["source_id"] and not lib.ID_RE.match(clean["source_id"]):
        problems.append("the short id can only use lowercase letters, numbers and dashes, like sams-pacific-coast")
    if problems:
        raise ValueError("; ".join(problems).capitalize() + ".")
    return ("# Your collection of missions (fields: SCHEMA.md).\n"
            f"name: {scalar(clean['name'])}\n"
            f"source_id: {clean['source_id']}   # permanent: starts every mission's full id ({clean['source_id']}/<file name>). Never change it.\n"
            f"author: {scalar(clean['author'])}\n"
            "schema_version: 1\n")


def apply(root, info=None):
    """Creates every missing file. Returns the paths created. Raises ValueError when the collection info is needed
    and missing, before anything is written."""
    root = Path(root)
    todo = [i["path"] for i in plan(root)]
    catalog = _catalog_text(info or {}) if "missions/catalog.yaml" in todo else None
    name = " ".join(str((info or {}).get("name") or "Mission packs").split())
    created = []
    for rel in todo:
        target = root / rel
        if rel == "missions/catalog.yaml":
            text = catalog
        elif rel == "README.md":
            text = (STARTER / "README.md").read_text(encoding="utf-8").replace("{name}", name)
        elif rel == "tools/amble_checks.py":
            text = (HERE / "amble_checks.py").read_text(encoding="utf-8")
        elif rel == "tools/check_missions.py":
            text = (HERE / "check.py").read_text(encoding="utf-8")
        elif rel == ".gitignore":
            gi = root / ".gitignore"
            if gi.exists():                   # an existing .gitignore only ever gets lines added
                add = missing_ignores(root)
                if add:
                    old = gi.read_text(encoding="utf-8")
                    gi.write_text(old + ("" if old.endswith("\n") else "\n") + "\n# kept on this computer only (AmbleBee mission manager)\n"
                                  + "\n".join(add) + "\n", encoding="utf-8")
                    created.append(".gitignore (added lines)")
                continue
            text = (STARTER / "gitignore").read_text(encoding="utf-8")
        elif rel == ".github/workflows/check-missions.yml":
            text = (STARTER / "check-missions.yml").read_text(encoding="utf-8")
        else:
            text = (STARTER / Path(rel).name).read_text(encoding="utf-8")
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(target, "x", encoding="utf-8") as f:   # "x": never replaces a file that appeared meanwhile
                f.write(text)
        except FileExistsError:
            continue
        created.append(rel)
    return created


def update_checker(root):
    """Replaces tools/amble_checks.py with the manager's copy. Only for repos that have an older one."""
    info = checker_info(root)
    if info["shared"] or info["repo"] is None:
        raise ValueError("This repo has no separate copy of the checker to update.")
    if not info["outdated"]:
        raise ValueError("The repo's checker is already up to date.")
    target = Path(root) / "tools" / "amble_checks.py"
    tmp = target.with_name(".amble_checks.py.tmp")
    tmp.write_text((HERE / "amble_checks.py").read_text(encoding="utf-8"), encoding="utf-8")
    tmp.replace(target)
    return checker_info(root)


# ---------- packs ----------

PACK_LIMITS = {"name": 40, "region": 40, "description": 200}


def create_pack(root, data):
    """Makes missions/<id>/pack.yaml. Returns the pack id. Raises ValueError with a plain-words reason."""
    missions = Path(root) / "missions"
    if not (missions / "catalog.yaml").exists():
        raise ValueError("Set up the repo first (it has no missions/catalog.yaml yet).")
    pid = str(data.get("id") or "").strip()
    v = {k: " ".join(str(data.get(k) or "").split()) for k in ("name", "region", "description", "icon")}
    places = str(data.get("places") or "optional").strip().lower()
    problems = []
    if not lib.ID_RE.match(pid):
        problems.append("The folder name can only use lowercase letters, numbers and dashes")
    elif pid == "general":
        problems.append("general is kept for missions that aren't in any pack; pick another folder name")
    elif (missions / pid / "pack.yaml").exists() or any(p.name.lower() == pid and p.name != pid for p in missions.iterdir()) \
            or ((missions / pid).exists() and not data.get("adopt")):
        problems.append(f"There's already a pack folder called {pid}")
    for key, limit in PACK_LIMITS.items():
        if not v[key]:
            problems.append(f"The pack needs a {key}")
        elif len(v[key]) > limit:
            problems.append(f"The {key} is {len(v[key])} characters; keep it to {limit}")
    if places not in lib.PLACES:
        problems.append(f"Places should be one of {', '.join(lib.PLACES)}")
    icon_dir = Path(root) / "icons" / "packs"
    if icon_dir.is_dir():
        if not v["icon"]:
            problems.append("Pick an icon")
        elif not (icon_dir / f"{v['icon']}.svg").exists():
            problems.append(f"There's no icon called {v['icon']} in icons/packs/")
    if problems:
        raise ValueError(". ".join(problems) + ".")
    lines = [f"name: {scalar(v['name'])}", f"region: {scalar(v['region'])}", f"description: {scalar(v['description'])}"]
    if v["icon"]:
        lines.append(f"icon: {scalar(v['icon'])}")
    lines.append(f"places: {places}   # required | optional | none: whether missions need a real place (SCHEMA.md)")
    text = "\n".join(lines) + "\n"
    yaml.safe_load(text)          # what we wrote must read back
    folder = missions / pid
    folder.mkdir(exist_ok=bool(data.get("adopt")))     # adopt: a folder of missions that never had a pack.yaml
    (folder / "pack.yaml").write_text(text, encoding="utf-8")
    return pid


def icons(root):
    """Icon names a pack can use (from icons/packs/), or None when the repo has no icon set."""
    d = Path(root) / "icons" / "packs"
    return sorted(f.stem for f in d.glob("*.svg")) if d.is_dir() else None
