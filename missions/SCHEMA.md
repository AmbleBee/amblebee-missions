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
| `tags` | Free-form list [none] |
| `credit` | Name of the person who suggested the mission, shown small under the title as "Suggested by …". Only for missions from contributors who asked to be credited; leave it blank or leave the line out otherwise (nothing shows; older missions without the line need no changes). A name only: no links or email addresses, 40 characters max. [none] |
