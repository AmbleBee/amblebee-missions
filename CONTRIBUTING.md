
# Contributing to AmbleBee

**Great adventures are even better when they're shared.**

AmbleBee is a free collection of date ideas, adventures, and little experiences designed to help people discover new places, try something different, and make memories.

Some of the best experiences aren't famous attractions. They're the quiet viewpoints, unusual museums, neighborhood traditions, and little discoveries that someone thought were worth sharing.

That's where you come in.

Whether you have one great idea, want to improve an existing mission, or would like to help build the collection, contributions are welcome.

**You don't need to be a developer to help AmbleBee grow.**

## Ways to Contribute

There are several ways to get involved, depending on your interests and experience.

| Contribution | Experience Needed | Availability |
|---|---|---|
| Suggest a mission | None | Available now |
| Report a problem or correction | None | Available now |
| Contribute to official missions | Basic GitHub knowledge | Available now |
| Use the local Mission Manager | Basic computer skills | Available now |
| Create and share community packs | To be determined | In development |

You don't need to write code, maintain a repository, or create an entire mission to make a useful contribution.

Even a single suggestion can help someone discover their next adventure.

---

## 1. Suggest a Mission

**The easiest way to contribute. No coding or GitHub account required.**

Know an incredible place? Have a creative date idea? Found a fun activity that more people should know about?

[**Suggest a Mission**](https://forms.gle/V8UZRwmDrLwzQpuM6)

You don't need to write a complete mission. Just tell us what makes the place or experience special.

Helpful information includes:

- The name and location of the place, if applicable.
- What makes it worth visiting or trying.
- What someone could do there.
- Any useful tips, challenges, or photo opportunities.
- Anything visitors should know before going.

It's perfectly fine to submit an idea you're still figuring out.

### What Happens Next?

Submitted ideas may be researched, checked, edited, and developed into official AmbleBee missions.

Not every suggestion will become a published mission. Some may already exist, need additional information, or fall outside the scope of the collection.

If you'd like recognition for an idea that becomes a mission, you can request contributor credit.

Published mission credits display a name only, without email addresses or social media links.

---

## 2. Improve an Existing Mission

Places change. Trails close, attractions move, information becomes outdated, and sometimes mistakes slip through.

Keeping AmbleBee useful and accurate is an ongoing effort.

You can help by reporting:

- Incorrect addresses or map coordinates.
- Closed, relocated, or inaccessible attractions.
- Outdated visitor information.
- Safety concerns or missing warnings.
- Broken links.
- Unclear descriptions or instructions.
- Better ways to experience an existing mission.

The easiest way to report a problem is to use the **Report a Problem** link on the mission's page at [amblebee.com](https://amblebee.com).

You can also submit corrections through a GitHub pull request.

Please include a source or explanation whenever possible, especially for changes involving safety, accessibility, or location details.

---

## 3. Add a Mission Through GitHub

If you're comfortable working with GitHub, you can contribute mission files directly.

AmbleBee stores missions as YAML files organized into packs.

Each mission has a permanent ID based on its filename, along with information describing the activity, its location, cost, difficulty, and other details.

### Getting Started

1. Fork this repository and create a branch for your contribution.
2. Copy `missions/_template.yaml` into the appropriate pack folder.
3. Give the file a descriptive lowercase name using dashes, such as `blue-pool-hike.yaml`.
4. Run `python tools/check_numbers.py` to find the next available mission number in that pack.
5. Complete the mission fields using [SCHEMA.md](missions/SCHEMA.md) as your reference.
6. Keep the mission marked `draft: true` until its information has been verified.
7. Run the mission validator.
8. Commit your changes and open a pull request.

### Example Structure

```text
missions/
├── anywhere/
│   └── sunset-picnic.yaml
├── oregon/
│   ├── pack.yaml
│   └── blue-pool-hike.yaml
└── washington/
    ├── pack.yaml
    └── example-adventure.yaml
```

### Validate Your Changes

Install the required dependency if necessary:

```bash
pip install pyyaml==6.0.1
```

Then run:

```bash
python tools/check_missions.py
```

The same validation process runs automatically when you open a pull request.

If the checker finds an issue, correct it before submitting whenever possible.

### Mission IDs and Numbers

A published mission's filename determines its permanent ID.

For example:

`blue-pool-hike.yaml` becomes `blue-pool-hike`.

Once published, that ID should not change, even if the mission moves to another pack.

Mission numbers must also remain permanent after publication. Never reuse a published number, including when a mission is retired.

If two pending contributions select the same number, the conflict can be resolved before merging.

---

## 4. Community Mission Packs

**Coming Soon — In Development**

AmbleBee is working toward allowing users to create, manage, and share their own mission packs.

The goal is to let anyone build a collection of adventures around their hometown, favorite activities, or a particular theme, then share those experiences with others.

**Community pack creation, publishing, and sharing are not currently available as supported public features.**

These capabilities are planned additions and are still being developed.

### What We're Working Toward

Future community packs could focus on:

- Hidden gems around your city.
- Affordable date ideas.
- Family-friendly weekend adventures.
- Waterfalls and scenic viewpoints.
- Cozy indoor activities.
- Photography challenges.
- Experiences you can enjoy anywhere.

The long-term goal is to make it possible for people to create personalized collections, organize missions, and share adventures with the AmbleBee community without needing programming experience.

### The Existing Mission Manager

This repository already includes a local Mission Manager used to maintain and organize the official AmbleBee mission library.

It provides tools for:

- Creating and editing missions.
- Creating and organizing packs locally.
- Validating mission information.
- Reviewing pack balance across cost, difficulty, and activity types.
- Identifying gaps in collections.
- Detecting potential duplicate locations.
- Finding missing information and missions needing review.
- Managing drafts and verified missions.
- Previewing changes before saving them.

The Mission Manager edits local files and does not require an AmbleBee account.

To launch it, clone or download the repository, install the necessary Python dependencies, and run:

```bash
python tools/mission_management
```

The application starts a local browser interface for managing mission collections.

**Important:** Although the Mission Manager supports local pack creation, it is not yet a complete community pack creation and sharing platform.

Creating a pack locally does not automatically publish it to AmbleBee or make it available to other users.

The underlying mission format can support independent collections, but a supported workflow for distributing and discovering community packs is still being developed.

### Follow Development

Community-created packs are part of AmbleBee's longer-term plans.

You can follow upcoming features and development progress on the [Bee Trail](https://amblebee.com/roadmap.html).

In the meantime, you're welcome to [suggest individual missions](https://forms.gle/V8UZRwmDrLwzQpuM6) for consideration in the official collection.

If you want to propose a large new official pack, please contact us before submitting the entire collection so we can discuss whether it fits the existing library.

The mission format is documented in [SCHEMA.md](missions/SCHEMA.md).

---

## Mission Writing Guidelines

Our goal is to make every mission useful, approachable, and worth experiencing.

A great mission should give someone a reason to try an activity, not merely describe a location.

### Make It an Experience

Rather than simply telling someone to visit a place, suggest something meaningful they can do there.

For example, a museum mission could invite visitors to find the exhibit that surprises them most and take a photograph of their favorite discovery, where photography is permitted.

A scenic overlook mission could encourage someone to arrive near sunset, enjoy the view, and capture the changing colors.

The goal is to turn an ordinary outing into a small adventure.

### Keep It Accessible and Approachable

Missions should be clear enough that someone unfamiliar with the area or activity can understand what to expect.

Include relevant information about difficulty, duration, cost, and accessibility when known.

Not every mission needs to be easy, inexpensive, or suitable for everyone.

Variety is important, but expectations should be clear.

### Research and Verify Information

Please check important details before submitting a mission.

For location-based missions, this includes:

- Confirming that the place exists and is accessible.
- Checking the correct entrance, parking area, or trailhead.
- Verifying coordinates using reliable sources.
- Reviewing any permits, reservations, or restrictions.
- Identifying relevant safety concerns.

Use official websites and reliable sources whenever possible.

If you've personally visited a location, firsthand observations are especially helpful. However, personal visits are not required to suggest a mission.

Please distinguish confirmed details from assumptions or information that still needs checking.

### Avoid Information That Quickly Becomes Outdated

Do not store exact opening hours or ticket prices in mission files.

Instead, link to the attraction's official website and use the appropriate `check_ahead` fields.

Cost categories are approximate and should reflect the experience rather than promise an exact price.

Only include discounts that an attraction publicly advertises, and don't store discount amounts.

### Include Useful Safety Information

Some experiences involve hazards that visitors should understand beforehand.

Examples include:

- Dangerous currents or unexpectedly cold water.
- Extreme temperatures or weather conditions.
- Limited or unavailable cell reception.
- Seasonal closures and restricted access.
- Difficult terrain or hazardous trail conditions.
- Activities requiring specialized equipment or experience.

Warnings should be specific, factual, and concise.

Never encourage trespassing, unsafe behavior, or bypassing posted restrictions.

A mission should make an experience more enjoyable without creating unnecessary risk.

### Keep the Mission Original

Contributions should be your own work or material you have permission to submit.

Do not copy descriptions, photographs, or substantial passages from other websites without the necessary rights.

You may use research and writing tools to help prepare a contribution, but you are responsible for reviewing the results, checking factual claims, and ensuring the submission is accurate and original.

Please don't submit invented locations, unverified claims presented as facts, or large batches of unchecked content.

---

## Mission Review and Publication

New missions begin as drafts.

A draft remains unpublished until its required details have been checked.

Before publication, missions may be reviewed for:

- Accuracy and completeness.
- Duplicate or substantially overlapping experiences.
- Location and coordinate accuracy.
- Safety and accessibility considerations.
- Clear, useful instructions.
- Compatibility with the mission format.
- Overall fit within the AmbleBee collection.

Contributions may be edited for clarity, consistency, or accuracy.

Submitting a mission does not guarantee publication. Some contributions may be declined, combined with existing ideas, or held for future consideration.

Once published, a mission may be updated as information changes.

---

## Contributor Credit

AmbleBee appreciates the people who help make the collection better.

Contributors who suggest a published mission can request a name credit using the mission's `credit` field.

For example:

```yaml
credit: "Alex M."
```

The website displays this as:

**Suggested by Alex M.**

Credit is optional.

To protect contributors' privacy and keep mission pages focused on the experience, credits should contain only a name or display name.

Do not include email addresses, personal contact information, or external links.

---

## Licensing and Contributions

Mission content within `missions/` is published under the [Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)](LICENSE).

By submitting mission content for inclusion in the official collection, you agree that your accepted contribution may be published under this license.

You must have the necessary rights to share your contribution under these terms.

This license allows others to copy, adapt, and redistribute the mission content subject to its attribution and ShareAlike requirements.

The mission content license does not automatically apply to the website's source code, icons, fonts, photographs, or other assets.

If you're contributing software, graphics, or other non-mission materials, please contact the maintainers to clarify the applicable permissions and licensing terms before submitting.

---

## Questions or Suggestions?

Not sure whether an idea fits AmbleBee? Need help with the mission format? Want to suggest an improvement to the Mission Manager?

You're welcome to reach out.

**Website:** [amblebee.com](https://amblebee.com)

**Email:** [staff@amblebee.com](mailto:staff@amblebee.com)

**Suggest a mission:** [Submission Form](https://forms.gle/V8UZRwmDrLwzQpuM6)

For technical changes, you can also open a GitHub issue or pull request.

---

## Thanks for Helping AmbleBee Grow

AmbleBee is built around a simple idea: memorable experiences don't always require elaborate plans, expensive equipment, or traveling somewhere extraordinary.

Sometimes the best adventures are the ones that help us notice what's already around us.

Every suggestion, correction, and contribution helps someone discover something they might otherwise have missed.

**Thanks for sharing a little adventure with the rest of us.**

[Explore AmbleBee](https://amblebee.com)
