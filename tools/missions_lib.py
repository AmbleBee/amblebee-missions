"""The mission checker now lives with the mission manager: tools/mission_management/amble_checks.py.

This file keeps `import missions_lib` working for the build tools (build_catalog.py, check_missions.py ...),
so the website build and the mission manager always run the exact same rules. Edit the rules there, not here.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "mission_management"))
import amble_checks as _checks  # noqa: E402

sys.modules[__name__] = _checks   # `import missions_lib` hands back the checker module itself
