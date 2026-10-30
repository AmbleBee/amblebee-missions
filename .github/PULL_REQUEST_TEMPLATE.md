## New mission(s)

Thanks for adding to AmbleBee! Copy `missions/_template.yaml`, fill it in, and save it in the right pack
folder. The file name is the mission's id (lowercase letters, numbers and dashes) and never changes.

**Which pack?**
- `anywhere/` (Amble Anywhere): can be done anywhere. No `place`.
- `oregon/`, `washington/`, … (Amble <State>): one specific real place. Needs a `place` with `coords`.

**Mission number:** run `python tools/check_numbers.py` and use the next free number in your pack. If someone
else's pull request takes that number first, we'll renumber yours when merging.

## Checklist

- [ ] One mission per file, in the right pack folder
- [ ] `draft: true` is still at the top (we remove it once the pin and address are checked)
- [ ] `short` fits on the camera screen (100 characters max)
- [ ] Place missions: `coords` picked on a map at the entrance, trailhead or parking lot (5 decimals)
- [ ] No opening hours, prices or map links stored (use `check_ahead` and `place.website`)
- [ ] Kid-friendly missions (`who` includes `kids`) have a `for_kids` block
- [ ] `themes` picked from the list in `missions/SCHEMA.md` (optional for now)
- [ ] `python tools/check_missions.py` passes (it also runs automatically on this pull request)
- [ ] I wrote this mission myself and agree it's shared under CC BY-SA 4.0 (see `CONTRIBUTING.md`)

## Anything we should know?

<!-- Why you love this place, a tip for going, a photo idea... -->
