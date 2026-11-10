
# AmbleBee Mission Catalog Schema

**Schema Version 1**

This document explains the file structure, fields, and validation rules used by AmbleBee mission collections.

AmbleBee missions are small invitations to explore, try something new, and make memories. Each mission is stored as an individual YAML file, making collections easy to create, organize, edit, and maintain.

This format is used by the official [AmbleBee Missions](https://amblebee.com) collection and the local AmbleBee Mission Manager.

For general contribution instructions, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Contents

1. [Quick Start](#quick-start)
2. [Catalog Structure](#catalog-structure)
3. [Catalog Information](#catalog-information)
4. [Creating Mission Packs](#creating-mission-packs)
5. [Mission Fields](#mission-fields)
6. [Locations and Coordinates](#locations-and-coordinates)
7. [Descriptions and Mission Links](#descriptions-and-mission-links)
8. [Photo Prompts and Kids' Versions](#photo-prompts-and-kids-versions)
9. [Gear Requirements](#gear-requirements)
10. [Themes and Tags](#themes-and-tags)
11. [Safety and Visitor Information](#safety-and-visitor-information)
12. [Drafts, Verification, and Publication](#drafts-verification-and-publication)
13. [Mission IDs and Numbering](#mission-ids-and-numbering)
14. [Validation](#validation)
15. [Maintainer Reference](#maintainer-reference)

---

## Quick Start

The easiest way to create and edit missions is through the local AmbleBee Mission Manager.

From the root of the official repository, run:

```bash
python tools/mission_management
```

The manager starts a local browser interface where you can create packs, edit missions, review collection balance, and check your work.

You can also edit the YAML files manually.

### Create a Mission Manually

1. Open the appropriate folder inside `missions/`.
2. Copy `missions/_template.yaml`.
3. Rename the copy using lowercase letters, numbers, and dashes.
4. Fill in the required fields.
5. Keep `draft: true` while the mission is being developed.
6. Validate the mission.
7. Add a `checked` date and remove `draft: true` when the mission is ready for publication.

### Example Mission

This is a simple draft for an activity that can be completed anywhere.

Save it as:

`missions/anywhere/sunset-photo-challenge.yaml`

```yaml
draft: true
number: 99
name: Sunset Photo Challenge
mode: both

short: Find somewhere peaceful and capture the changing colors of sunset.

description: >
  Find a comfortable place with a clear view of the sky.
  Arrive before sunset and spend some time watching the
  colors change. Take three photographs as the light fades,
  then choose the one that best captures the moment.

duration: short
effort: easy
cost: free
setting: outdoor
season: any
time_of_day: evening
travel: local

themes: [views, sunsets, relaxing]
tags: [sunset, photography, sky]
```

**Important:** The example number is a placeholder. Run `python tools/check_numbers.py` and replace it with an available number before submitting the mission.

The `draft: true` field keeps the mission unpublished while you're checking its details.

When the mission is ready, replace that field with a verification date:

```yaml
checked: 2026-11-10
```

Use the actual date you verified the mission, not the example date.

For missions about a real destination, you may also need a `place` block containing the location and coordinates.

---

## Catalog Structure

AmbleBee uses the following hierarchy:

**Source → Pack → Mission**

- **Source:** The overall collection and its author.
- **Pack:** A group of missions organized around a region, theme, or interest.
- **Mission:** An individual experience or activity.

### Example Directory Structure

```text
missions/
├── catalog.yaml
├── SCHEMA.md
├── _template.yaml
├── same-spot-ok.yaml
├── links-ok.yaml
│
├── general/
│   └── sunset-picnic.yaml
│
├── anywhere/
│   ├── pack.yaml
│   └── photo-scavenger-hunt.yaml
│
└── oregon/
    ├── pack.yaml
    ├── blue-pool-hike.yaml
    └── oregon-coast-aquarium.yaml
```

### Special Files

| File | Purpose |
|---|---|
| `catalog.yaml` | Identifies the overall mission collection |
| `SCHEMA.md` | Documents the mission format |
| `_template.yaml` | Starting template for new missions |
| `same-spot-ok.yaml` | Records locations intentionally shared by different missions |
| `links-ok.yaml` | Stores links manually confirmed as valid |

Files beginning with `_` are ignored when loading missions.

`links-ok.yaml` is intended to remain on the local computer and is excluded from Git through `.gitignore`.

The Mission Manager maintains the duplicate-location exceptions and link verification records.

---

## Catalog Information

Every collection has a `catalog.yaml` file inside its `missions/` directory.

This file identifies the collection and determines the prefix used for its missions.

### Example

```yaml
name: AmbleBee Missions
source_id: amblebee
author: AmbleBee
schema_version: 1
```

### Fields

| Field | Description |
|---|---|
| `name` | Collection name displayed on the Hive and mission tickets |
| `source_id` | Permanent identifier used to prefix mission IDs |
| `author` | Person or organization maintaining the collection |
| `schema_version` | Version of the mission data format |

The `source_id` should be short, unique, and permanent.

For example, a mission named `sunset-picnic.yaml` in a collection with `source_id: amblebee` receives the full ID:

`amblebee/sunset-picnic`

Do not change the source ID after publishing a collection.

The schema version should only change when the actual data format changes.

---

## Creating Mission Packs

A pack is a curated collection of missions.

Official AmbleBee packs are generally organized by state, alongside Amble Anywhere. However, the format supports packs organized around cities, activities, or themes.

Examples include:

- Amble Oregon
- Amble Washington
- Oregon Waterfalls
- Cozy Nights In
- Weekend Photography Adventures

Each pack normally has its own folder containing a `pack.yaml` file.

The `general/` folder is reserved for missions that are not assigned to a pack and does not need `pack.yaml`.

### Example Pack

File: `missions/oregon/pack.yaml`

```yaml
name: Amble Oregon
region: Oregon
description: Date ideas and adventures across Oregon.
icon: evergreen
places: required

about: >
  Discover scenic viewpoints, unusual attractions,
  outdoor adventures, and memorable experiences
  across the state.
```

### Pack Fields

| Field | Description |
|---|---|
| `name` | Pack's display name |
| `region` | Geographic area or region associated with the pack |
| `description` | Short description, usually one or two sentences |
| `places` | Determines whether missions require real-world locations |
| `icon` | SVG icon name from `icons/packs/`, without `.svg` |
| `about` | Optional longer introduction shown on the pack's website page |

### Location Requirements

The `places` field accepts three values:

| Value | Behavior |
|---|---|
| `required` | Every mission needs a `place` with coordinates |
| `optional` | Missions may have a location, but do not require one |
| `none` | Missions must not contain a `place` block |

Examples:

- State-based packs such as Amble Oregon normally use `required`.
- A themed pack combining outings and activities at home can use `optional`.
- Amble Anywhere uses `none`.

If `places` is omitted, the current checker uses these conventions:

- The `anywhere` folder defaults to `none`.
- Packs named `Amble ...` default to `required`.
- Other packs default to `optional`.

For new packs, explicitly setting `places` is recommended.

### Pack Icons

The `icon` field refers to an SVG file in `icons/packs/`.

For example:

```yaml
icon: evergreen
```

References:

`icons/packs/evergreen.svg`

See [Icon Documentation](../icons/README.md) for the requirements when creating new icons.

### Longer Pack Descriptions

Use `about: >` for a longer description.

```yaml
about: >
  Oregon is home to rugged coastlines, forests,
  waterfalls, mountains, and unusual small towns.

  This pack brings together memorable experiences
  from across the state.
```

Blank lines separate paragraphs.

The pack's `about` content appears on the website but is excluded from the compact `catalog.json` downloaded by the Hive.

---

## Mission Fields

Every mission is an individual YAML file.

Required fields define the experience. Optional fields provide additional details for filtering, planning, and displaying missions.

### Required Fields

| Field | Description | Allowed Values |
|---|---|---|
| `number` | Permanent mission number within its pack | Available number |
| `name` | Mission title | Text |
| `mode` | Type of experience | `date`, `adventure`, `both` |
| `short` | Short description for the camera's e-ink display | Text, maximum 100 characters |
| `description` | Main mission instructions | Text, maximum 800 characters |
| `duration` | Approximate time required | `short`, `half-day`, `all-day` |
| `effort` | Physical effort or difficulty | `easy`, `moderate`, `hard` |

### Mission Type

```yaml
mode: both
```

| Value | Meaning |
|---|---|
| `date` | Intended as a date experience |
| `adventure` | Intended as a general adventure |
| `both` | Suitable as either a date or an adventure |

For missions that support friends, families, or solo participation, use the optional `who` field.

Avoid descriptions that assume two people are participating when the mission is intended for a broader audience.

### Duration

| Value | Meaning |
|---|---|
| `short` | Approximately 1–3 hours |
| `half-day` | Around half a day |
| `all-day` | A full-day experience |

### Effort

| Value | Meaning |
|---|---|
| `easy` | Low physical effort |
| `moderate` | Some physical activity or preparation |
| `hard` | More demanding activity or preparation |

Effort should reflect what visitors reasonably need to complete the mission.

### Optional Fields

| Field | Description | Default |
|---|---|---|
| `who` | Additional audiences: `solo`, `friends`, `family`, `kids` | None |
| `for_kids` | Simplified activity and photo prompts for children | None |
| `about` | Background, history, and practical details for the website | None |
| `steps` | Guided photo or activity prompts | None |
| `place` | Real-world destination information | Depends on pack |
| `gear` | Specialized equipment genuinely required | None |
| `cost` | Approximate cost category | `$` |
| `setting` | Indoor or outdoor setting | `either` |
| `season` | Suitable seasons | `any` |
| `time_of_day` | Recommended time of day | `any` |
| `travel` | Travel category | `local` |
| `check_ahead` | Information visitors should check before going | None |
| `discounts` | Groups offered discounts by a destination | None |
| `caution` | Important website-only safety or visitor warning | None |
| `caution_until` | Expiration date for a temporary warning | None |
| `checked` | Date the mission was last verified | None |
| `draft` | Prevents an unfinished mission from being published | `false` |
| `routine` | Marks a repeatable activity or routine | `false` |
| `themes` | Up to six predefined activity themes | None |
| `tags` | Additional searchable keywords | Empty list |
| `credit` | Optional contributor name | None |

### Cost Categories

| Value | Meaning |
|---|---|
| `free` | Free experience |
| `$` | Under $20 for two |
| `$$` | $20–$60 |
| `$$$` | Over $60 |

These are broad categories, not exact price guarantees.

Parking, transportation, optional purchases, and other incidental expenses may still apply.

### Setting

Allowed values:

`indoor`, `outdoor`, `either`

### Season

Use `any` or a list containing one or more of:

`spring`, `summer`, `fall`, `winter`

Example:

```yaml
season: [spring, summer, fall]
```

### Time of Day

Allowed values:

`any`, `morning`, `daytime`, `evening`, `night`

### Travel

Allowed values:

`home`, `local`, `drive`, `day-trip`

### Repeatable Activities

Use:

```yaml
routine: true
```

For activities intended to be repeated regularly.

Leave it out or use `false` for ordinary missions.

---

## Locations and Coordinates

The `place` block describes a specific physical destination.

It is required for missions in packs with `places: required`, optional in packs with `places: optional`, and omitted in packs with `places: none`.

### Example

```yaml
place:
  name: Example Nature Center
  area: Portland, Oregon
  address: 123 Example Street, Portland, OR
  coords: [45.12345, -122.12345]
  website: https://example.com
  links:
    - label: Visitor information
      url: https://example.com/visit
```

### Place Fields

| Field | Description |
|---|---|
| `name` | Name of the destination |
| `area` | City, neighborhood, or general area |
| `address` | Physical address, when available |
| `coords` | Latitude and longitude |
| `website` | Main destination website |
| `links` | Up to three additional useful links |

### Coordinate Format

Coordinates use decimal degrees:

```yaml
coords: [45.12345, -122.12345]
```

The order is:

`[latitude, longitude]`

For state-based packs, coordinates are required and should use five decimal places.

Choose a practical arrival location, such as:

- Main entrance.
- Trailhead.
- Parking area.
- Dock or boat launch.
- Visitor entrance.

Avoid placing the marker in the middle of a lake, an inaccessible area, or somewhere that does not represent where visitors should arrive.

Coordinates are used for nearby mission searches and distance calculations.

### Destination Links

The main website belongs in `place.website`.

Additional links use:

```yaml
links:
  - label: Bike rentals
    url: https://example.com/rentals
```

Rules:

- Maximum three additional links.
- Link labels must be 25 characters or fewer.
- Links should be relevant to the experience.
- Prefer official or trustworthy sources.

Do not store generated Google Maps or Apple Maps links in the mission.

AmbleBee builds map links from the destination information.

---

## Descriptions and Mission Links

AmbleBee separates mission instructions from background information.

### Short Description

The `short` field is shown on the camera's e-ink display.

Maximum length: **100 characters**.

It should quickly explain what the mission involves.

### Main Description

The `description` field contains the actual mission.

Maximum length: **800 characters**.

Aim for approximately 400 characters when practical.

A good description tells visitors:

- What to do.
- What makes the experience interesting.
- A small challenge or reason to explore.
- What photograph or memory to capture.

Example:

```yaml
description: >
  Visit the garden and explore its winding paths.
  Find a plant or flower you've never noticed before,
  then take a photograph of your favorite discovery.
```

This description appears on the Hive's mission card and near the top of the website ticket.

### About This Place

The optional `about` field provides additional background information.

Maximum length: **1,500 characters**.

Use it for:

- Interesting history.
- Unusual facts.
- Helpful visitor tips.
- Parking and access information.
- Permits and seasonal considerations.
- Connections to other nearby experiences.

Example:

```yaml
about: >
  This historic garden has been a quiet retreat
  for visitors for many years.

  Spring brings colorful flowers, while autumn
  offers changing leaves and peaceful walking paths.
```

The `about` content appears on the mission's website page under **About this place**.

It is not included in the compact mission catalog downloaded by the camera or Hive.

### Linking to Other Missions

The `about` field supports internal links to other missions.

Use the linked mission's permanent filename ID in double brackets:

```text
[[wallowa-lake-tramway]]
```

Example:

```yaml
about: >
  If you have time for another adventure, consider
  visiting [[wallowa-lake-tramway]] while you're nearby.
```

The website converts the reference into a link displaying the mission's name.

If the referenced mission is still a draft, the name is displayed as plain text.

The validator checks these references for mistakes.

Internal mission links are currently supported in `about`, not in other text fields.

---

## Photo Prompts and Kids' Versions

Some missions include additional guided prompts.

### Photo or Activity Steps

Use `steps` to provide a sequence of prompts:

```yaml
steps:
  - Find something colorful.
  - Photograph an interesting detail.
  - Take a picture that captures the atmosphere.
```

Each step can appear as a separate prompt on the camera.

### Who Can Participate

The optional `who` field accepts a list containing:

`solo`, `friends`, `family`, `kids`

Example:

```yaml
who: [solo, friends, family]
```

Date-only missions normally omit this field.

### Kids' Version

When `who` includes `kids`, a `for_kids` section is required.

Example:

```yaml
who: [family, kids]

for_kids:
  short: Find three interesting things on your adventure!
  steps:
    - Find something red.
    - Spot an unusual shape.
    - Take a picture with your grown-up.
```

The kids' version uses simpler language and age-appropriate photo prompts.

Children should be supervised as appropriate for the activity.

---

## Gear Requirements

The `gear` field identifies specialized equipment genuinely required to complete a mission.

Only list equipment that:

1. Is necessary for the activity.
2. Many households may not already own.

Do not list ordinary everyday items such as water bottles, blankets, coolers, or standard flashlights simply because they might be useful.

### Example

```yaml
gear:
  - item: headlamps
    rent: on-site
```

### Rental Options

For place-based missions, the `rent` field accepts:

| Value | Meaning |
|---|---|
| `on-site` | Equipment can be rented at the destination |
| `nearby` | Equipment can be rented nearby |
| `"no"` | Visitors must bring their own |

Keep `"no"` in quotes because YAML may otherwise interpret it as a boolean value.

Amble Anywhere missions omit the `rent` field.

Equipment already provided as part of an activity or admission does not need to be listed separately.

Seasonal equipment requirements that aren't consistently necessary should be explained in the description.

### Supported Gear

| Group | Allowed Items |
|---|---|
| Water | `kayak`, `canoe`, `paddleboard`, `life-jackets`, `wetsuit`, `river-tube`, `fishing-gear` |
| Camping | `tent`, `sleeping-bags`, `camp-stove`, `hammock` |
| Snow | `snowshoes`, `skis`, `snowboard`, `sled`, `traction-spikes` |
| Wheels | `bikes`, `roller-skates` |
| Cooking | `grill` |
| Sky and nature | `telescope`, `binoculars` |
| Climbing and caves | `climbing-gear`, `headlamps` |
| Games and sport | `golf-clubs`, `disc-golf-discs`, `tennis-rackets`, `kite` |
| Transportation | `high-clearance-vehicle` |

The validator rejects gear items outside this list.

---

## Themes and Tags

Themes and tags help visitors discover missions matching their interests.

They serve different purposes.

- **Themes:** A predefined set of categories used for website filters.
- **Tags:** Additional free-form keywords used by search.

### Themes

Use the `themes` field for the primary types of experience a mission offers.

Example:

```yaml
themes: [hiking, waterfalls, forests]
```

Rules:

- Maximum six themes per mission.
- Only supported theme IDs are accepted.
- Duplicate themes are not allowed.
- Themes are currently optional.
- Pick themes visitors would genuinely use to find the mission.

A waterfall hike might use:

```yaml
themes: [hiking, waterfalls]
```

It should not include every loosely related nature category.

Themes should not duplicate information already represented by other fields, such as cost, setting, season, or audience.

The `romantic` theme is reserved for missions with `mode: date` or `mode: both`.

### Supported Themes

#### Outdoors and Nature

| ID | Display Label |
|---|---|
| `views` | Views & lookouts |
| `hiking` | Hiking |
| `walks` | Easy walks & strolls |
| `waterfalls` | Waterfalls |
| `beach` | Beaches & coast |
| `lakes-rivers` | Lakes, rivers & wetlands |
| `mountains` | Mountains |
| `deserts` | Deserts |
| `swimming` | Swimming & springs |
| `boating` | Out on the water |
| `caves` | Caves & underground |
| `rocks-fossils` | Rocks & fossils |
| `forests` | Forests & fall color |
| `parks` | National & state parks |
| `wildlife` | Animals & wildlife |
| `gardens` | Gardens & flowers |
| `stars` | Stars & space |
| `biking` | Biking |
| `picnic` | Picnics |
| `sunsets` | Sunrise & sunset |

#### Culture and History

| ID | Display Label |
|---|---|
| `history` | History |
| `museums` | Museums |
| `science` | Science & discovery |
| `art` | Art |
| `architecture` | Architecture & bridges |
| `vehicles` | Planes, trains & cars |
| `spooky` | Spooky & mysterious |

#### Food and Fun

| ID | Display Label |
|---|---|
| `food` | Food & treats |
| `drinks` | Wine, beer & cocktails |
| `markets` | Markets & shopping |
| `movies` | Movies |
| `shows` | Music & shows |
| `games` | Games & arcades |
| `thrills` | Rides & thrills |
| `quirky` | Quirky & roadside |
| `holidays` | Holidays & festivals |
| `road-trips` | Scenic drives & road trips |

#### The Feel of It

| ID | Display Label |
|---|---|
| `playful` | Playful & silly |
| `romantic` | Romantic |
| `relaxing` | Calm & cozy |
| `small-towns` | Small towns |
| `make-something` | Make or learn something |

### Tags

The `tags` field supports additional searchable keywords.

Example:

```yaml
tags: [cemetery, epitaphs, historic-graves]
```

Tags are free-form and do not need to be chosen from the predefined theme list.

Use them for meaningful details that help someone find the mission.

Avoid unnecessary repetition:

- `free` belongs in `cost`.
- Indoor or outdoor belongs in `setting`.
- `kids` belongs in `who`.
- A supported theme belongs in `themes`.

### Suggesting Themes Automatically

The repository includes a helper script:

```bash
python tools/suggest_themes.py
```

It suggests themes based on existing tags.

To add suggested themes to missions that do not already have them:

```bash
python tools/suggest_themes.py --write
```

Review the suggestions rather than assuming they are always correct.

The script does not replace themes already assigned to a mission.

---

## Safety and Visitor Information

Mission details should help visitors understand what they may need to check before going.

### Check Ahead

The `check_ahead` field accepts:

| Value | Meaning |
|---|---|
| `hours` | Opening hours |
| `tickets` | Tickets or admission |
| `reservation` | Reservation requirements |
| `seasonal` | Seasonal availability |
| `conditions` | Weather, trail, or other current conditions |

Example:

```yaml
check_ahead: [hours, tickets, reservation]
```

Do not store exact opening hours or ticket prices in mission files.

Those details can change, and visitors should consult official sources.

### Discounts

The `discounts` field identifies groups for which an attraction advertises discounts.

Supported values:

- `senior`
- `military`
- `first-responder`
- `healthcare`
- `educator`
- `student`
- `government`
- `local`
- `birthday`

Example:

```yaml
discounts: [senior, military, student]
```

Only include publicly advertised discount categories.

Do not store exact discount amounts.

The website displays these under the visitor information as groups that may be eligible for discounts.

### Safety Warnings

Use `caution` for an important warning visitors should see.

Example:

```yaml
caution: "This location has no cell service. Download offline maps first."
```

Warnings appear in a highlighted box on the website ticket.

They are not sent to the camera or Hive.

Guidelines:

- Keep warnings factual and specific.
- Aim for fewer than 120 characters.
- Maximum length is 200 characters.
- Avoid repeating generic instructions to check before going.
- Focus on information that materially affects the experience.

Examples include dangerous water conditions, limited cell reception, restricted access, and difficult terrain.

### Temporary Warnings

Use `caution_until` when a warning has an expiration date.

Example:

```yaml
caution: "The main trail is temporarily closed for maintenance."
caution_until: 2026-12-01
```

Dates use:

`YYYY-MM-DD`

The website displays the warning through the specified date and hides it afterward.

This is useful for temporary closures, construction, or maintenance.

Do not use an expiration date for permanent conditions such as unreliable cell coverage.

The validator reports expired cautions for cleanup, but an expired warning does not cause the build to fail.

---

## Drafts, Verification, and Publication

AmbleBee distinguishes between missions still being developed and missions ready for publication.

### Draft Missions

Use:

```yaml
draft: true
```

Draft missions remain in the repository but are excluded from:

- The public website's mission pages.
- The published mission catalog.
- The missions available to the camera and Hive.

Drafts are still checked by the validator, and their assigned numbers remain reserved.

### Verified Missions

Every live mission requires a `checked` date.

Example:

```yaml
checked: 2026-11-10
```

The date records when the mission's relevant information was last verified.

For place-based missions, review information such as:

- Location and entrance.
- Coordinates.
- Destination availability.
- Visitor restrictions.
- Relevant hours and conditions.

For Amble Anywhere missions, review whether the activity and instructions remain sensible and accurate.

The website displays a simplified verification date, such as:

**Checked November 2026**

### Publishing a Mission

To publish a verified draft:

1. Review the mission's details.
2. Confirm coordinates and important visitor information.
3. Remove `draft: true`.
4. Add `checked` using the actual verification date.
5. Run the mission validator.
6. Commit and push the changes.

The Mission Manager also provides a publishing action for verified drafts.

### Date Validation

The `checked` field must use a valid date in `YYYY-MM-DD` format.

The validator rejects:

- Invalid dates.
- Dates in the future.
- Verification dates before January 1, 2026.

Every live mission must have a valid `checked` date.

---

## Mission IDs and Numbering

Mission identity must remain stable over time.

### Mission IDs

A mission's filename determines its ID.

Example:

```text
sunset-picnic.yaml
```

Mission ID:

`sunset-picnic`

Full ID with the catalog source prefix:

`amblebee/sunset-picnic`

Filename requirements:

- Lowercase letters.
- Numbers.
- Dashes.

Do not rename a published mission file.

Permanent IDs allow the mission to retain its identity even if its pack changes.

### Moving Missions Between Packs

The containing folder determines the mission's pack.

Moving:

```text
missions/general/sunset-picnic.yaml
```

To:

```text
missions/anywhere/sunset-picnic.yaml
```

Changes the pack assignment but preserves the mission's filename-based ID.

Any move should still be reviewed for compatibility with the destination pack's rules.

### Mission Numbers

Every mission has a number within its pack.

Example:

```yaml
number: 3
```

Numbers are permanent once published.

Do not:

- Renumber published missions.
- Reuse retired mission numbers.
- Assign the same number to multiple missions in one pack.

Find available numbers with:

```bash
python tools/check_numbers.py
```

If two pending pull requests select the same unused number, resolve the conflict before merging.

Published mission numbers and IDs should remain stable.

---

## Validation

The mission validator checks the structure and accepted values of the collection.

Run it from the repository root:

```bash
python tools/check_missions.py
```

Install the required dependency if necessary:

```bash
pip install pyyaml==6.0.1
```

### What Validation Checks

Validation includes:

- Required mission fields.
- Supported values and field formats.
- Mission IDs and numbering.
- Pack location requirements.
- Coordinates and location fields.
- Maximum text lengths.
- Gear and rental values.
- Theme IDs and theme limits.
- Kids' version requirements.
- Verification dates and draft status.
- Internal mission references.
- Other structural and consistency rules.

The Mission Manager uses the same underlying validation rules when saving mission changes.

Automated validation also runs through GitHub Actions.

### Validation Is Not Fact-Checking

Passing validation means a mission follows the supported data format.

It does not guarantee that:

- An attraction is open.
- Coordinates point to the correct entrance.
- An activity is currently safe.
- A link's destination is useful.
- A description is accurate.

Review real-world details before publishing.

### Additional Checks

The repository also includes supporting tools, including:

```bash
python tools/check_numbers.py
python tools/check_packs.py
python tools/check_pins.py
```

These provide additional information about mission numbering, pack requirements, and map coordinates.

The Mission Manager offers a browser-based interface for reviewing mission information and identifying items needing attention.

---

## Maintainer Reference

This section is intended for people maintaining the mission format, validation rules, and website.

Ordinary contributors generally do not need to modify these settings.

### Authoritative Validation Rules

The main validation implementation lives in:

```text
tools/mission_management/amble_checks.py
```

The file:

```text
tools/missions_lib.py
```

acts as a compatibility wrapper for the existing website build tools.

Modify validation rules in `amble_checks.py`, not in the wrapper.

### Theme Definitions

Themes are defined in the `THEMES` dictionary in `amble_checks.py`.

The dictionary controls:

- Supported theme IDs.
- Display labels.
- Display order.

When introducing a new theme:

1. Add its ID and label to `THEMES`.
2. Update this schema document.
3. Review the Mission Manager's theme-group presentation.
4. Confirm the website displays and filters the new theme correctly.
5. Run validation and browser tests.

Avoid themes that duplicate existing fields.

### Requiring Themes

The validator currently uses:

```python
THEMES_REQUIRED = False
```

This permits missions without a `themes` field while the collection is being updated.

Once all missions have appropriate themes, maintainers may choose to change this setting to `True`.

Do not enable it until the existing collection is ready.

### Theme Limit

The maximum number of themes per mission is controlled by:

```python
THEMES_MAX = 6
```

Keeping the limit small prevents missions from appearing under nearly every filter.

### Coordinate Verification Notes

The checker recognizes comments indicating that a location still needs verification.

For example:

```yaml
coords: [45.12345, -122.12345]  # APPROX: verify before publishing
```

Drafts may contain these notes.

The current checker blocks live missions containing such verification notes.

This behavior is controlled by:

```python
PIN_NOTES_BLOCK_LIVE = True
```

Remove unresolved verification notes after confirming the coordinates.

### Checker Version

The validation implementation contains a `CHECKER_VERSION` value.

When validation rules change, maintainers should update this version as appropriate.

The Mission Manager uses it to identify independently created collections with outdated copies of the checker.

### Keeping Starter Collections Updated

The Mission Manager includes starter files under:

```text
tools/mission_management/starter/
```

The starter schema should remain synchronized with:

```text
missions/SCHEMA.md
```

Changes to the mission format should be reflected in both locations.

Ideally, the starter copy should be updated automatically as part of the maintainer workflow.

### Schema Changes

Changes to supported fields, accepted values, or validation behavior should be treated as format changes rather than documentation edits.

Before introducing a schema change:

1. Review compatibility with existing missions.
2. Update the authoritative validator.
3. Update the Mission Manager where necessary.
4. Update relevant build and website code.
5. Update the mission template.
6. Update both schema documentation files.
7. Run the mission checks and browser tests.
8. Consider whether `schema_version` needs to change.

Preserving compatibility is especially important as community-created collections become available.

---

## Further Information

- [AmbleBee Website](https://amblebee.com)
- [Official Repository](https://github.com/AmbleBee/amblebee-missions)
- [Contribution Guidelines](../CONTRIBUTING.md)
- [Icon Documentation](../icons/README.md)
- [Project Roadmap](https://amblebee.com/roadmap.html)

**The schema defines how missions are stored. The experiences themselves are what make AmbleBee worth exploring.**
