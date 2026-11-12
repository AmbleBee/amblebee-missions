
# AmbleBee Missions

**Less wondering what to do. More memories worth keeping.**

[Explore AmbleBee](https://amblebee.com) | [Suggest a Mission](https://amblebee.com/suggest/) | [Contribute](CONTRIBUTING.md)

AmbleBee is a free collection of date ideas, adventures, and little experiences designed to help people get out, try something new, and make memories.

Whether you're planning a date night, exploring a new city, looking for something to do with friends, or just trying to get out of the house, AmbleBee helps take the guesswork out of deciding what to do.

No subscriptions, no complicated planning, and no need to spend a fortune. Just pick a mission and go.

## How It Works

Every AmbleBee mission is a little invitation to experience something.

Missions can take you to a scenic overlook, an unusual museum, a quiet garden, or somewhere you've never thought to visit. Others can be completed right at home.

Each mission includes useful details to help you decide whether it's right for you:

- **Date or Adventure:** Something to enjoy together or on your own.
- **Time & Effort:** From easy outings to full-day adventures.
- **Cost:** Free experiences, affordable activities, and occasional splurges.
- **Setting & Season:** Indoor, outdoor, seasonal, and anytime activities.
- **The Mission:** A small challenge, experience, or photo prompt that makes the outing memorable.

You can explore individual missions, browse curated packs, or let AmbleBee choose your next adventure.

[Find your next mission](https://amblebee.com)

## Mission Packs

Missions are organized into collections called *Amble Packs*.

AmbleBee's official collection includes state-based packs and **Amble Anywhere**, a collection of experiences you can enjoy almost anywhere.

Packs can also be built around specific themes, locations, or interests.

The goal isn't to visit every destination or complete every mission. It's to find experiences that fit your life, your interests, and your sense of adventure.

## Help the Hive Grow

Some of the best adventures are the places and experiences people share with one another.

Know a hidden gem? Have an unusual date idea? Found an experience you think others would love?

**We'd love to hear about it.**

You don't need programming experience, a GitHub account, or a complete mission written out.

You can help by:

- **[Suggesting a mission](https://amblebee.com/suggest/)** — Share an idea and let us handle the research and writing.
- **Reporting an issue** — Use the report link on any mission to flag outdated or incorrect information.
- **Contributing directly** — Add or improve missions through a GitHub pull request.
- **Creating your own packs** — Use the included Mission Manager to organize a collection of adventures.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## AmbleBee Mission Manager

**Build adventures without writing YAML by hand.**

This repository includes the AmbleBee Mission Manager, a local browser-based tool for creating, editing, checking, and organizing mission collections.

It's designed to make building packs easier, whether you're maintaining a few missions or managing an entire collection.

### What It Can Do

- **Create and edit missions** using a guided form.
- **Create new packs** without manually setting up their folders.
- **Track pack balance** across cost, difficulty, setting, and mission type.
- **Find missing categories** using the coverage dashboard and gap finder.
- **Check mission quality** and identify information needing attention.
- **Detect potential problems**, including duplicate locations, outdated reviews, and missing information.
- **Manage drafts** and publish missions after verification.
- **Preview changes** before they're saved to the mission files.

The Mission Manager edits local files in your repository. It does not require an online account.

### Launch the Mission Manager

Clone or download this repository, then run:

```bash
python tools/mission_management
```

The application starts a local web interface and provides the address to open in your browser.

Python and the project's required dependencies must be installed.

For the mission format and pack structure, see [SCHEMA.md](missions/SCHEMA.md).

## Repository Structure

| Location | Purpose |
|---|---|
| `missions/` | Mission files organized into packs |
| `tools/mission_management/` | Local Mission Manager and editing tools |
| `tools/` | Build scripts, checks, and utilities |
| `site/` | Website interface, styles, and JavaScript |
| `pages/` | About, Contact, Safety, Privacy, and other pages |
| `icons/` | Pack icons and website graphics |
| `data/` | City and ZIP code lookup data |
| `collections.yaml` | Curated mission collections and themed pages |
| `roadmap.yaml` | Public project roadmap and updates |
| `.github/workflows/` | Automated testing and GitHub Pages deployment |

Each mission is stored as an individual YAML file, making it possible to maintain, validate, and organize the collection without requiring a database.

## Development

AmbleBee is built as a static website using Python build scripts, HTML, CSS, and JavaScript.

The public website is hosted through GitHub Pages and automatically rebuilt when changes are pushed to `main`.

### Preview Locally

Install the required build dependency:

```bash
pip install pyyaml==6.0.1
```

Then run:

```bash
bash tools/preview.sh
```

This checks the mission collection, builds the website, and starts a local preview at:

`http://localhost:8811`

### Validate Missions

```bash
python tools/check_missions.py
```

### Browser Testing

```bash
pip install playwright==1.64.1
python -m playwright install chromium
python tools/smoke_test.py
```

The GitHub Actions workflow also tests the website in Chromium, Firefox, and WebKit before deployment.

New missions remain drafts until their details have been checked.

## The Bigger Picture

AmbleBee started with a simple problem: wanting to go on more dates and adventures, but never quite knowing what to do.

The missions are the first part of a larger idea.

The long-term vision brings together discovering adventures, capturing photographs, and keeping those memories through an AmbleBee camera and its companion Hive photo frame.

The camera and Hive are still in development. The missions are available to explore today.

You can follow the project's progress on the [Bee Trail](https://amblebee.com/roadmap.html).

## Licensing

Mission content in `missions/` is shared under [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](LICENSE).

The mission content license does not automatically cover the website code, icons, or other assets.

Fonts have separate licenses included in `site/fonts/`. ZIP code and city lookup data originate from the U.S. Census Bureau and are public domain.

## A Little Adventure Goes a Long Way

You don't have to travel far, spend a lot, or plan something extraordinary to make a memory worth keeping.

Sometimes all it takes is a little curiosity and a reason to get out the door.

**Pick a mission. Go somewhere. Make a memory.**

[Start exploring at AmbleBee.com](https://amblebee.com)
