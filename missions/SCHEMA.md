# Mission catalog format (schema version 1)

```
missions/
  catalog.yaml          source information (one per collection)
  SCHEMA.md             this file
  _template.yaml        copy this to start a new mission (files starting with _ are ignored)
  general/              missions that aren't in a pack
    sunset-picnic.yaml
  portland/             a pack: one folder per pack
    pack.yaml           pack information
    voodoo-doughnut-run.yaml
```

Structure is **source > pack > mission**. A pack is a curated, usually place-specific collection
(Portland, Seattle) that people can add or skip on its own. Themes (ocean, camping, rainy day)
are tags and filters, not packs.

**The file name is the mission's id** (`sunset-picnic.yaml` → id `sunset-picnic`, shown on the Hive
as `max/sunset-picnic`). Ids are permanent: never rename a published mission's file. Use lowercase
letters, numbers and dashes.

**The folder is the pack.** Moving a file to another folder moves the mission to that pack; its id
(and its history) stays the same.

Check your changes with `python tools/check_missions.py` (also part of the test task).

## catalog.yaml

| Field | Meaning |
|---|---|
| `name` | Shown on the Hive's source list and on mission tickets ("Max's Missions") |
| `source_id` | Short, unique, never changes; prefixes every mission id (`max/...`) |
| `author` | Who maintains the collection |
| `schema_version` | Bump only when the field format changes |
| `updated` | Date of the last change (YYYY-MM-DD) |

## pack.yaml (one per pack folder; `general/` needs none)

| Field | Meaning |
|---|---|
| `name` | Pack name ("Portland") |
| `region` | Where it applies ("Portland, OR") |
| `description` | One or two sentences |
| `icon` | Name of an icon in `icons/packs/`, without `.svg` (`evergreen`, `needle`, `covered-bridge`…). To add one, see `icons/README.md`. |

## Mission files

### Required

| Field | Values |
|---|---|
| `number` | Permanent number within its pack ("Mission 3 of 12 in Portland"). Never reuse or renumber, even if a mission is removed. |
| `name` | Mission title |
| `mode` | `date` (you and your partner), `adventure` (everyone else), or `both` |
| `short` | One line for the Amblebee's e-ink screen, 100 characters max |
| `description` | A few sentences for the Hive's mission card |
| `duration` | `short` (1-3 hrs), `half-day`, `all-day` |
| `effort` | `easy`, `moderate`, `hard` |

### Optional (default in brackets)

| Field | Values |
|---|---|
| `who` | List of who else can come: `solo`, `friends`, `family`, `kids`. Date-only missions leave it out. [none] |
| `for_kids` | Required when `who` includes `kids`. `short`: one simple sentence; `steps`: simple photo prompts, one per camera screen |
| `steps` | Prompts for a guided mission, one camera screen each [none] |
| `place` | **Required in every state pack** (Amble Oregon, Amble Texas...), **left out in Amble Anywhere**; the checker enforces both. Fields: `name`, `area`, `address`, `coords: [lat, lon]` (required in state packs: the entrance, dock or trailhead, 5 decimals; used for Near you and distances), optional `website`, optional `links` (up to 3 extra buttons: a list of `label` + `url`, labels 25 characters max, e.g. `- label: Bike rentals` / `url: https://...`). Map links are never stored; the Hive builds them from the address or coords. |
| `cost` | `free`, `$` (under $20 for two), `$$` ($20-60), `$$$` (over $60) [`$`] |
| `setting` | `indoor`, `outdoor`, `either` [`either`] |
| `season` | `any` or a list of `spring`, `summer`, `fall`, `winter` [`any`] |
| `time_of_day` | `any`, `morning`, `daytime`, `evening`, `night` [`any`] |
| `travel` | `home`, `local`, `drive`, `day-trip` [`local`] |
| `check_ahead` | What to check before going: `hours`, `tickets`, `reservation`, `seasonal`, `conditions` (weather / trail / sky). Never store actual hours (they go stale); use `place.website`. [none] |
| `discounts` | Groups the place gives discounts to: `senior`, `military` (incl. veterans), `first-responder`, `healthcare`, `educator`, `student`, `government`, `local` (residents), `birthday`. Shown under "Check before you go" as "Ask about discounts: …" and searchable. Only list ones the place advertises; never store amounts (they change). [none] |
| `caution` | One short warning shown in a yellow box on the **website** ticket, right below the notes ("Check before you go", discounts, gear). Never shown on the Amblebee or the Hive. One or two short sentences, aim for under 120 characters (200 max; that's about 3 lines on a phone), e.g. `This location has no cell service. Download offline maps first.` Say the fact itself rather than repeating "check before you go". [none] |
| `caution_until` | Optional date (`YYYY-MM-DD`) the caution ends; the website shows it through that day and hides it after. Use it for anything temporary (closures, maintenance, construction); leave it out for lasting facts like no cell service. Needs a `caution`. `python tools/check_missions.py` lists cautions that have ended so you can delete them; an ended caution never fails the check. [none] |
| `draft` | `true` keeps the mission out of the website and catalog.json (and so off the Hive) while its pin, address or details still need checking. It's still checked by `check_missions.py`, and its number stays taken. Delete the line once it's verified to publish it. New missions from the template start as drafts. [`false`] |
| `routine` | `true` for repeatable routines [`false`] |
| `themes` | Up to 6 themes from the fixed list (see **Themes** below), e.g. `[views, hiking]`. They're the "What kind of mission" filter chips on the website. **Optional for now**: missions without the line pass the check and publish as usual, while themes get filled in. [none] |
| `tags` | Free-form keywords, used by search (`[cemetery, epitaphs]`). Anything goes, but words that are a theme belong in `themes`, and words that repeat a field don't need to be tags at all (`free` is `cost`, `rainy-day` is `setting: indoor`, `kids` is `who`). [none] |
| `credit` | Name of the person who suggested the mission, shown small under the title as "Suggested by …". Only for missions from contributors who asked to be credited; leave it blank or leave the line out otherwise (nothing shows; older missions without the line need no changes). A name only: no links or email addresses, 40 characters max. [none] |

## Themes (added 2026-10-29)

A fixed list, so filters work: each theme is a chip under "What kind of mission" in the website's
More filters, with a live count of how many missions you could get. Picking several chips shows
missions that fit **any** of them. The chips only appear once some published mission has themes.

- Pick the 1-6 that a visitor would actually filter by. A waterfall hike is `[hiking, waterfalls]`,
  not every theme it brushes against.
- Themes never repeat a field: no theme for free, indoor/outdoor, kids, season or time of day, since
  the filters for those already exist.
- `check_missions.py` fails a themes line with a word that isn't on the list, the same theme twice,
  or more than 6. A mission with no themes line passes (`THEMES_REQUIRED = False` in
  `tools/missions_lib.py`; flip it to `True` once every mission has themes).
- `python tools/suggest_themes.py` suggests themes from a mission's tags; `--write` adds the
  `themes:` line to missions that don't have one (never touches ones that do). Check its picks as
  you verify each mission.
- New theme: add it to `THEMES` in `tools/missions_lib.py` (the order there is the chip order) and to
  the table below; the label is what the chip says.

| Group | Themes (`id` and the chip's label) |
|---|---|
| Outdoors and nature | `views` (Views & lookouts), `hiking` (Hiking), `walks` (Easy walks & strolls), `waterfalls` (Waterfalls), `beach` (Beaches & coast), `lakes-rivers` (Lakes, rivers & wetlands), `mountains` (Mountains), `deserts` (Deserts), `swimming` (Swimming & springs), `boating` (Out on the water), `caves` (Caves & underground), `rocks-fossils` (Rocks & fossils), `forests` (Forests & fall color), `parks` (National & state parks), `wildlife` (Animals & wildlife), `gardens` (Gardens & flowers), `stars` (Stars & space), `biking` (Biking), `picnic` (Picnics), `sunsets` (Sunrise & sunset) |
| Culture and history | `history` (History), `museums` (Museums), `science` (Science & discovery), `art` (Art), `architecture` (Architecture & bridges), `vehicles` (Planes, trains & cars), `spooky` (Spooky & mysterious) |
| Food and fun | `food` (Food & treats), `drinks` (Wine, beer & cocktails), `markets` (Markets & shopping), `movies` (Movies), `shows` (Music & shows), `games` (Games & arcades), `thrills` (Rides & thrills), `quirky` (Quirky & roadside), `holidays` (Holidays & festivals), `road-trips` (Scenic drives & road trips) |
| The feel of it | `playful` (Playful & silly), `romantic` (Romantic), `relaxing` (Calm & cozy), `small-towns` (Small towns), `make-something` (Make or learn something) |

