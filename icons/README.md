
# AmbleBee Icon Library

AmbleBee uses a shared collection of simple, lightweight SVG icons throughout the website.

These icons help identify mission packs, display useful information, and give the interface a consistent visual style.

The icon system is designed to be:

- **Simple:** Easy to recognize, even at small sizes.
- **Consistent:** A shared visual style across the website.
- **Lightweight:** Small SVG files without unnecessary complexity.
- **Adaptable:** Icons inherit their color from the interface.
- **Accessible:** Clear shapes that remain recognizable without relying on color alone.
- **Future-ready:** Designed with the AmbleBee camera and Hive's black-and-white e-ink displays in mind.

Icons are intentionally minimal. They should support the experience without distracting from it.

## Contents

1. [Icon Organization](#icon-organization)
2. [Using Pack Icons](#using-pack-icons)
3. [Creating a New Icon](#creating-a-new-icon)
4. [SVG Requirements](#svg-requirements)
5. [Design Guidelines](#design-guidelines)
6. [Validating Icons](#validating-icons)
7. [How Icons Are Built](#how-icons-are-built)
8. [Adding New Icon Categories](#adding-new-icon-categories)
9. [Contributing](#contributing)

---

## Icon Organization

Icons are organized into separate folders based on their purpose.

```text
icons/
├── README.md
├── packs/
│   ├── evergreen.svg
│   ├── lighthouse.svg
│   ├── mountain.svg
│   └── ...
└── site/
    ├── discount.svg
    └── kid.svg
```

### Icon Categories

| Folder | Purpose |
|---|---|
| `packs/` | Icons representing mission packs, regions, and collections |
| `site/` | General website interface icons and indicators |

Each folder is treated as a separate icon collection.

For example, an icon referenced by a mission pack is looked up in `icons/packs/`, not `icons/site/`.

Additional categories may be introduced as AmbleBee develops.

New folders are not automatically recognized by the icon builder. They must be added to its supported icon sets.

## Using Pack Icons

Each mission pack can specify an icon in its `pack.yaml` file.

Example:

```yaml
name: Amble Oregon
region: Oregon
description: Date ideas and adventures across Oregon.
icon: evergreen
places: required
```

The `icon` field references:

```text
icons/packs/evergreen.svg
```

Use only the filename without the `.svg` extension.

For example:

```yaml
icon: lighthouse
```

References:

```text
icons/packs/lighthouse.svg
```

The referenced file must exist in the `packs/` directory.

The mission validator checks that pack icons are valid references.

For details about mission packs, see [Mission Schema](../missions/SCHEMA.md).

---

## Creating a New Icon

The easiest way to create a new icon is to copy an existing SVG from `icons/packs/` and modify its shapes.

### Step 1: Choose an Existing Icon

Find an icon that is similar in complexity or shape to what you want to create.

Existing icons provide examples of the correct dimensions, stroke settings, and visual style.

### Step 2: Create a New File

Copy the existing SVG and give it a descriptive filename.

For example:

```text
icons/packs/covered-bridge.svg
```

Filenames must use:

- Lowercase letters.
- Numbers.
- Dashes between words.

Avoid spaces, underscores, uppercase letters, and special characters.

### Step 3: Edit the SVG

Use a text editor or SVG design application to modify the shapes.

Keep the icon simple and consistent with the rest of the library.

### Step 4: Validate

Run:

```bash
python tools/build_icons.py
```

Correct any reported errors before committing the icon.

### Step 5: Use the Icon

Once validated, the icon can be referenced from a pack's `pack.yaml`.

For example:

```yaml
icon: covered-bridge
```

---

## SVG Requirements

AmbleBee uses a restricted SVG format to keep icons consistent, lightweight, and safe to include in generated website content.

These requirements are enforced by `tools/build_icons.py`.

### Canvas Size

Every icon must use:

```xml
viewBox="0 0 24 24"
```

This provides a consistent 24 × 24 coordinate system.

Keep most of the visible drawing within approximately coordinates 2 through 22.

This leaves breathing room around the edges and prevents icons from appearing cramped.

### Stroke Style

Use the following visual conventions:

| Property | Recommended Value |
|---|---|
| ViewBox | `0 0 24 24` |
| Stroke width | `2.2` |
| Stroke line cap | `round` |
| Stroke line join | `round` |
| Main stroke | `currentColor` |
| Main fill | `none` |

Most icons should be outlines rather than solid illustrations.

Small filled details, such as dots, are acceptable when they improve recognition.

The website provides the surrounding SVG wrapper and its normal stroke styling.

### Example SVG

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24"
     fill="none"
     stroke="currentColor"
     stroke-width="2.2"
     stroke-linecap="round"
     stroke-linejoin="round">
  <path d="M3 19L12 5L21 19"/>
  <path d="M8 19L12 13L16 19"/>
</svg>
```

This example draws a simple mountain using two paths.

Save it as an `.svg` file in the appropriate icon folder.

### Allowed SVG Elements

The icon builder currently accepts:

| Element | Purpose |
|---|---|
| `path` | Custom lines and shapes |
| `circle` | Circles |
| `ellipse` | Elliptical shapes |
| `rect` | Rectangles |
| `line` | Straight lines |
| `polyline` | Connected line segments |
| `polygon` | Closed geometric shapes |
| `g` | Grouping shapes |

Other drawing elements are not supported by the current validator.

### Colors and Fills

For `fill` and `stroke`, only these values are accepted:

- `none`
- `currentColor`

For example:

```xml
<circle cx="12" cy="12" r="2"
        fill="currentColor"
        stroke="none"/>
```

Do not use hardcoded colors such as hexadecimal color codes, named colors, or RGB values.

Using `currentColor` allows icons to adapt automatically to the website's visual theme.

This is particularly important for light mode, dark mode, and future monochrome displays.

### Unsupported Features

The current icon builder does not support:

- Embedded images or photographs.
- Gradients.
- Text elements.
- Scripts or interactive behavior.
- External resources.
- Arbitrary SVG elements or attributes.
- Hardcoded fill or stroke colors.

Keep icons as simple geometric shapes.

The builder also restricts SVG attributes and their values.

If an SVG editor introduces extra metadata, styling, or unsupported attributes, those may need to be removed before validation.

---

## Design Guidelines

A good AmbleBee icon should communicate its meaning quickly, even when displayed at a small size.

### Keep It Recognizable

Use simple silhouettes and distinctive shapes.

Avoid adding unnecessary details that become difficult to see when the icon is reduced.

For example:

- A lighthouse should have a recognizable tower and light.
- A mountain should have a clear peak or ridgeline.
- A bridge should have a recognizable span.
- A tree should have a recognizable trunk and canopy.

The icon doesn't need to be a detailed illustration.

### Design for Small Sizes

Pack icons may appear at approximately 18 pixels in compact parts of the interface.

Website interface icons may appear at approximately 15 pixels.

Before submitting an icon, check how it looks at these sizes.

If important details disappear, simplify the design.

### Maintain Consistent Visual Weight

Icons should feel as though they belong to the same collection.

Use similar:

- Stroke thickness.
- Spacing.
- Detail levels.
- Line endings.
- Visual proportions.

Avoid making one icon significantly heavier or more elaborate than its neighbors.

### Avoid Depending on Color

Icons should remain understandable in monochrome.

This supports accessibility and the long-term goal of using the same visual language with AmbleBee's camera and Hive hardware.

Do not use color as the only way to distinguish an icon's meaning.

### Leave Room Around the Edges

Keep drawings comfortably inside the 24 × 24 viewBox.

Icons that touch the edges may appear crowded or clipped.

### Prefer Familiar Symbols

When possible, use recognizable visual concepts rather than abstract designs.

A simple icon is usually more useful than an elaborate one that requires explanation.

---

## Validating Icons

The repository includes a validator and build tool:

```bash
python tools/build_icons.py
```

Run this command from the repository root.

It checks supported icon folders for formatting and structural problems.

### What the Validator Checks

The validator checks:

- SVG file readability.
- Valid SVG structure.
- Required `viewBox`.
- Supported filenames.
- Supported drawing elements.
- Allowed SVG attributes.
- Allowed fill and stroke colors.
- Unsafe or unsupported attribute values.
- Empty icon files.

If an icon fails validation, the script reports the file and the problem.

Correct the issue and run validation again.

### Checking Pack References

You can also run:

```bash
python tools/check_missions.py
```

This checks the mission collection, including references to pack icons.

A pack referencing an icon that doesn't exist will fail validation.

### Automated Checks

The repository's GitHub Actions workflow also checks icons during the build process.

Invalid icons can prevent the website from deploying until the issue is corrected.

---

## How Icons Are Built

AmbleBee doesn't publish every icon as a separate image request for the website.

Instead, the build process reads supported SVG files and extracts their drawing elements into a generated JSON file.

Run:

```bash
python tools/build_icons.py --out _site/icons.json
```

The resulting file contains icon markup organized by category.

A simplified example:

```json
{
  "packs": {
    "mountain": "<path d=\"M3 19L12 5L21 19\"/>"
  },
  "site": {}
}
```

The website can then place the icon markup inside its own SVG wrapper.

This approach provides several advantages:

- Icons share consistent styling.
- Icons inherit the website's text or interface color.
- The browser doesn't need a separate SVG file request for each displayed icon.
- SVG content is checked before being included in the generated website.
- The icon system remains lightweight.

The generated `icons.json` file is a build artifact.

**Edit the source SVG files, not the generated JSON.**

---

## Adding New Icon Categories

The current icon builder recognizes two icon collections:

```python
SETS = ("packs", "site")
```

These are defined in:

```text
tools/build_icons.py
```

Creating another folder inside `icons/` does not automatically make it available to the website.

If a new category is needed:

1. Create the appropriate folder under `icons/`.
2. Add the category name to `SETS` in `tools/build_icons.py`.
3. Update the relevant website code to use the new category.
4. Add appropriate SVG icons.
5. Run the icon validator.
6. Update this documentation.

For example, a future category for equipment icons could use:

```python
SETS = ("packs", "site", "gear")
```

This is only an example of a possible future extension.

The website must also be updated to request icons from that category.

---

## Contributing

New icons and improvements to existing icons are welcome.

Before submitting a pull request:

1. Check whether a suitable icon already exists.
2. Follow the established visual style.
3. Keep the design simple and recognizable.
4. Use an appropriate filename.
5. Avoid unsupported SVG features.
6. Run `python tools/build_icons.py`.
7. Run the relevant mission checks if you've changed pack icon references.
8. Include a brief explanation of the icon's purpose.

If you're introducing a new icon category or substantially changing the icon system, consider discussing the change with the maintainers first.

For general contribution information, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Further Information

- [AmbleBee Website](https://amblebee.com)
- [Official Repository](https://github.com/AmbleBee/amblebee-missions)
- [Mission Schema](../missions/SCHEMA.md)
- [Contribution Guidelines](../CONTRIBUTING.md)
- [Project Roadmap](https://amblebee.com/roadmap.html)

---

**Good icons should make adventures easier to discover without getting in the way of the experience.**
