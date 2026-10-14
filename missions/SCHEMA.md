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
| `icon` | One-word icon name (bridge, needle, evergreen, wave, tent…) |

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
| `place` | For place-specific missions: `name`, `area`, `address`, optional `coords: [lat, lon]` (trailheads, viewpoints), optional `website`. Map links are never stored; the Hive builds them from the address or coords. |
| `cost` | `free`, `$` (under $20 for two), `$$` ($20-60), `$$$` (over $60) [`$`] |
| `setting` | `indoor`, `outdoor`, `either` [`either`] |
| `season` | `any` or a list of `spring`, `summer`, `fall`, `winter` [`any`] |
| `time_of_day` | `any`, `morning`, `daytime`, `evening`, `night` [`any`] |
| `travel` | `home`, `local`, `drive`, `day-trip` [`local`] |
| `check_ahead` | What to check before going: `hours`, `tickets`, `reservation`, `seasonal`, `conditions` (weather / trail / sky). Never store actual hours (they go stale); use `place.website`. [none] |
| `routine` | `true` for repeatable routines [`false`] |
| `tags` | Free-form list [none] |
