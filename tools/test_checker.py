"""Tests for the mission checker's rules (tools/missions_lib.py), on a tiny catalog built in a temp folder.

    python tools/test_checker.py
"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import missions_lib as lib  # noqa: E402

MISSION = """\
{draft}number: 1
name: Test Falls
mode: both
who: [friends]
place:
  name: Test Falls Trailhead
  area: Testville
  coords: [45.50000, -122.50000]{note}
short: Walk to the falls and take a photo.
description: >
  Walk the short trail to the falls, pick the best spot together, and take a photo of you with the falls.
duration: short
effort: easy
themes: [waterfalls]
{extra}"""


class CheckerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "missions"
        (self.root / "oregon").mkdir(parents=True)
        shutil.copy(ROOT / "missions" / "catalog.yaml", self.root / "catalog.yaml")
        shutil.copy(ROOT / "missions" / "oregon" / "pack.yaml", self.root / "oregon" / "pack.yaml")
        self.addCleanup(shutil.rmtree, self.tmp)
        self.addCleanup(setattr, lib, "PIN_NOTES_BLOCK_LIVE", lib.PIN_NOTES_BLOCK_LIVE)

    def problems(self, draft=False, note="", extra=""):
        text = MISSION.format(draft="draft: true\n" if draft else "checked: 2026-11-01\n", note=note, extra=extra)
        (self.root / "oregon" / "test-falls.yaml").write_text(text, encoding="utf-8")
        return lib.check_catalog(self.root)

    def assertProblem(self, problems, words):
        self.assertTrue(any(words in p for p in problems), f"expected a problem mentioning {words!r}, got {problems}")

    def test_clean_mission_passes(self):
        self.assertEqual(self.problems(), [])

    # ---- gear ----
    def test_known_gear_with_rent_passes(self):
        self.assertEqual(self.problems(extra="gear:\n  - item: headlamps\n    rent: on-site\n"), [])

    def test_every_listed_gear_item_is_accepted(self):
        items = "".join(f"  - item: {g}\n" for g in sorted(lib.GEAR))
        self.assertEqual(self.problems(extra="gear:\n" + items), [])

    def test_unknown_gear_item_fails(self):
        self.assertProblem(self.problems(extra="gear:\n  - item: jetpack\n"), "isn't in the gear list")

    def test_gear_written_as_plain_word_fails(self):
        self.assertProblem(self.problems(extra="gear: [kayak]\n"), "isn't in the gear list")

    def test_bad_rent_fails(self):
        self.assertProblem(self.problems(extra="gear:\n  - item: kayak\n    rent: maybe\n"), "gear rent 'maybe'")

    def test_every_rent_value_is_accepted(self):
        for rent in sorted(lib.RENT):
            self.assertEqual(self.problems(extra=f'gear:\n  - item: kayak\n    rent: "{rent}"\n'), [], rent)

    def test_unquoted_rent_no_explains_the_quotes(self):
        self.assertProblem(self.problems(extra="gear:\n  - item: kayak\n    rent: no\n"), 'write rent: "no"')

    # ---- fields written twice ----
    def test_field_written_twice_fails(self):
        self.assertProblem(self.problems(extra="name: Another Name\n"), "'name' is written twice")

    # ---- "check the pin before publishing" notes ----
    def test_pin_note_is_only_a_reminder_while_switch_is_off(self):
        lib.PIN_NOTES_BLOCK_LIVE = False
        self.assertEqual(self.problems(note="  # APPROX: set at the entrance before publishing"), [])

    def test_pin_note_on_live_mission_fails_with_switch_on(self):
        lib.PIN_NOTES_BLOCK_LIVE = True
        self.assertProblem(self.problems(note="  # APPROX: set at the entrance before publishing"),
                           "still says the pin needs checking")

    def test_pin_note_on_draft_is_fine_with_switch_on(self):
        lib.PIN_NOTES_BLOCK_LIVE = True
        self.assertEqual(self.problems(draft=True, note="  # APPROX: set at the entrance before publishing"), [])

    def test_pin_notes_finds_the_usual_wordings(self):
        for note in ("# APPROX: set at the dock", "# verify: corner of Jefferson", "# placeholder",
                     "# trailhead coords from WTA; confirm before publishing"):
            self.assertTrue(lib.pin_notes(f"coords: [1, 2]  {note}"), note)
        self.assertFalse(lib.pin_notes("coords: [1, 2]  # entrance on the north side"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
