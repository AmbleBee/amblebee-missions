
# {name}

**A collection of little adventures, memorable experiences, and reasons to get out and explore.**

Created with the [AmbleBee Mission Manager](https://github.com/AmbleBee/amblebee-missions), a tool for building and organizing custom date and adventure mission packs.

AmbleBee is about making it easier to discover new experiences, spend time together, and create memories worth keeping.

This repository contains a custom collection of missions built around that same idea.

## About This Collection

Mission packs are collections of experiences organized around a location, activity, theme, or shared interest.

A pack might focus on:

- Hidden gems in a particular city or region.
- Affordable date nights.
- Family-friendly weekend adventures.
- Scenic drives, hikes, and viewpoints.
- Museums, history, and unusual attractions.
- Creative activities and indoor experiences.
- Adventures that can be enjoyed almost anywhere.

Each mission offers an activity, challenge, or experience to try.

The goal isn't necessarily to complete every mission. It's to find something that interests you, get out and experience it, and make a memory along the way.

## How Missions Work

Every mission is stored as a YAML file containing the details needed to understand and organize an experience.

Depending on the mission, that information may include:

- **Name and Description:** What the experience involves and why it's worth trying.
- **Date or Adventure:** Whether it's designed for a date, a general adventure, or both.
- **Duration:** Approximately how much time the activity requires.
- **Difficulty:** How much physical effort or preparation may be involved.
- **Cost:** An approximate price category.
- **Location:** Where to go, when a specific destination is required.
- **Setting and Season:** Whether the mission is indoors, outdoors, or best enjoyed at certain times.
- **Themes:** Categories that help people find experiences matching their interests.
- **Photo Prompts:** Optional challenges or ideas for capturing a memory.

A mission can be as simple as watching the sunset somewhere new or as involved as spending a day exploring an unfamiliar destination.

For the complete field reference, see [Mission Schema](missions/SCHEMA.md).

## Repository Structure

Mission collections use the following structure:

```text
missions/
├── catalog.yaml
├── SCHEMA.md
├── _template.yaml
├── first-pack/
│   ├── pack.yaml
│   ├── first-mission.yaml
│   └── second-mission.yaml
└── second-pack/
    ├── pack.yaml
    └── another-mission.yaml

tools/
├── check_missions.py
└── amble_checks.py

.github/
└── workflows/
    └── check-missions.yml
```

### Important Files

| File or Folder | Purpose |
|---|---|
| `missions/catalog.yaml` | Identifies the collection, its author, and its permanent source ID |
| `missions/SCHEMA.md` | Documents the supported mission fields and formatting rules |
| `missions/_template.yaml` | Provides a starting point for creating missions manually |
| `missions/<pack>/pack.yaml` | Defines an individual pack |
| `missions/<pack>/*.yaml` | Contains the missions belonging to that pack |
| `tools/check_missions.py` | Runs the mission validator |
| `tools/amble_checks.py` | Contains the validation rules |
| `.github/workflows/check-missions.yml` | Runs validation automatically through GitHub Actions |

Each mission is stored independently, making collections easy to edit, maintain, and organize.

## Creating and Editing Missions

There are two ways to work with this collection.

### Option 1: Use the AmbleBee Mission Manager

**Recommended for most users.**

The AmbleBee Mission Manager provides a local browser-based interface for creating, editing, checking, and organizing missions.

It includes tools for:

- Creating new missions and packs.
- Editing mission information through forms.
- Tracking indoor and outdoor activity balance.
- Comparing inexpensive and higher-cost experiences.
- Reviewing date and adventure coverage.
- Identifying gaps in a collection.
- Finding possible duplicate locations.
- Flagging outdated or incomplete information.
- Managing drafts and verified missions.
- Previewing changes before saving them.

The Mission Manager works with local files and does not require an AmbleBee account.

#### Launching the Mission Manager

The Mission Manager is distributed with the official AmbleBee repository. It is not automatically included in every independently generated mission collection.

Download or clone the [AmbleBee Missions repository](https://github.com/AmbleBee/amblebee-missions) and install the required Python dependency:

```bash
pip install pyyaml==6.0.1
```

From the official repository, launch the manager and point it at this collection:

```bash
python tools/mission_management --repo /path/to/your/collection
```

Replace `/path/to/your/collection` with the actual folder containing this repository.

The application prints a local address to open in your web browser.

Changes are saved directly to the mission files in your collection.

You can then review, commit, and push those changes using Git as usual.

### Option 2: Edit YAML Files Manually

If you prefer a text editor, you can create and edit missions directly.

1. Open the appropriate folder inside `missions/`.
2. Copy `missions/_template.yaml`.
3. Give the new file a descriptive name using lowercase letters, numbers, and dashes.
4. Complete the required fields.
5. Keep `draft: true` until the mission has been checked.
6. Run the mission validator.
7. Save and commit your changes.

For example:

```text
missions/oregon-waterfalls/example-waterfall.yaml
```

The filename determines the mission's permanent ID.

Once a mission is published, avoid changing its ID so existing references remain valid.

See [Mission Schema](missions/SCHEMA.md) for the required fields and supported values.

## Checking Your Missions

Every mission should be validated before being considered ready.

Install PyYAML if it isn't already available:

```bash
pip install pyyaml==6.0.1
```

Run the validator from the root of this collection:

```bash
python tools/check_missions.py
```

The validator checks mission structure and supported field values, helping identify problems before they become part of the collection.

When this repository is hosted on GitHub, the included GitHub Actions workflow also runs the validator automatically on pushes.

**Validation does not replace fact-checking.**

A mission can have valid YAML while still containing an incorrect address, an outdated attraction, or misleading information.

Always review important details before considering a mission complete.

## Building a Balanced Collection

A good mission pack offers variety.

Not everyone wants the same experience, and even the same person may want something different depending on the day.

When building a pack, consider including a mixture of:

- Dates and general adventures.
- Indoor and outdoor activities.
- Free, inexpensive, and higher-cost experiences.
- Easy activities and more challenging outings.
- Short experiences and full-day adventures.
- Popular destinations and lesser-known discoveries.
- Activities suitable for different interests and group sizes.

The Mission Manager includes coverage tools to help identify gaps in these areas.

These are guidelines, not requirements. A specialized pack may intentionally focus on one type of experience.

For example, a waterfall collection will naturally contain more outdoor adventures than indoor dates.

The goal is to make a collection useful and enjoyable for its intended audience.

## Writing Great Missions

A great mission should offer more than a place to visit.

It should give someone a small experience to look forward to.

### Make It Memorable

Instead of simply describing a destination, suggest something visitors can do there.

That might mean finding an unusual exhibit, discovering a favorite viewpoint, trying a new activity, or taking a photograph that captures the experience.

A small challenge can turn an ordinary outing into something more memorable.

### Keep Information Accurate

For location-based missions:

- Confirm that the destination exists and is accessible.
- Check addresses and coordinates carefully.
- Use practical arrival points such as entrances or trailheads.
- Include relevant safety or access information.
- Link to official sources when appropriate.
- Avoid storing exact opening hours and ticket prices that may quickly become outdated.

Use the available mission fields to explain what visitors should check before going.

### Keep It Approachable

Not every mission needs to be expensive, physically demanding, or complicated.

Simple experiences can be just as memorable as elaborate adventures.

Write clearly, set realistic expectations, and help people understand what they're signing up for.

### Respect People and Places

Missions should never encourage trespassing, unsafe behavior, environmental damage, or disregard for posted restrictions.

Be considerate of local communities, wildlife, and the places being visited.

## Community Pack Sharing

**Coming Soon — In Development**

AmbleBee is developing ways for people to create, manage, discover, and share their own mission packs.

The long-term goal is to make community-created adventure collections available without requiring users to understand GitHub or YAML.

**Public community pack publishing and sharing are not currently available as supported AmbleBee features.**

The Mission Manager already supports creating and organizing collections locally, but it does not currently provide a complete public distribution system.

You may maintain your own collection using the tools in this repository. However, doing so does not automatically publish it on amblebee.com or make it discoverable through AmbleBee.

You can follow development progress on the [AmbleBee Bee Trail](https://amblebee.com/roadmap.html).

## Contributing to Official AmbleBee Missions

Have an idea that would make a great addition to the official AmbleBee collection?

You don't need to build an entire pack to contribute.

You can:

- [Suggest a mission](https://forms.gle/V8UZRwmDrLwzQpuM6).
- Report incorrect or outdated information on an existing mission.
- Contribute directly through the official GitHub repository.

See the [AmbleBee Contribution Guidelines](https://github.com/AmbleBee/amblebee-missions/blob/main/CONTRIBUTING.md) for more information.

Independent collections are separate from the official AmbleBee mission library. Creating a mission locally does not guarantee its inclusion in the official collection.

## Licensing

Missions from the official AmbleBee collection are provided under the Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0).

If you reuse or adapt those missions, you must follow the applicable license terms.

New, independently authored mission content is not automatically licensed under CC BY-SA 4.0 merely because it was created using the Mission Manager.

Collection authors are responsible for choosing appropriate licensing terms for their original content and ensuring they have permission to include any third-party material.

The Mission Manager, website code, icons, fonts, and other resources may have separate licensing terms.

For official AmbleBee licensing information, visit the [AmbleBee Missions repository](https://github.com/AmbleBee/amblebee-missions).

## About AmbleBee

AmbleBee is a project built around a simple idea:

**Less wondering what to do. More memories worth keeping.**

It began as a way to make choosing dates and adventures easier, with the longer-term vision of connecting those experiences to a simple camera and a digital photo frame called the Hive.

The missions are available today, while the camera, Hive, and community features continue to develop.

Learn more at [amblebee.com](https://amblebee.com).

---

**Pick a mission. Go somewhere. Make a memory.**

[Explore AmbleBee](https://amblebee.com)
