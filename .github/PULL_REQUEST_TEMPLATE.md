
# Contributing to AmbleBee

Thanks for taking the time to help improve AmbleBee!

Whether you're adding an adventure, correcting outdated information, fixing a bug, or improving the tools behind the project, your contribution is appreciated.

Please complete the sections relevant to your changes. You can leave unrelated checkboxes unchecked.

For additional guidance, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Type of Contribution

What does this pull request change?

- [ ] Add one or more new missions
- [ ] Improve or update existing missions
- [ ] Correct inaccurate or outdated information
- [ ] Fix a bug
- [ ] Improve the website or user experience
- [ ] Improve the Mission Manager or development tools
- [ ] Update documentation
- [ ] Other

## Description

**What does this pull request do?**

Briefly describe your changes and why they're useful.

<!-- Explain what you added, fixed, or improved. -->

**Related issues (optional):**

<!-- Link related issues using #123, or write "None". -->

## Mission Contributions

Complete this section if you're adding or modifying mission files.

### Mission Details

**Mission name(s):**

<!-- List the missions being added or modified. -->

**Pack(s):**

<!-- For example: Amble Oregon, Amble Washington, Amble Anywhere. -->

**What makes this experience worth sharing?**

<!-- Tell us what makes the place or activity interesting, memorable, or worth trying. -->

### Mission Checklist

Check the items that apply to your changes.

- [ ] Each new mission has its own YAML file.
- [ ] New missions are placed in the appropriate pack folder.
- [ ] New mission filenames use lowercase letters, numbers, and dashes.
- [ ] Existing published mission IDs have not been changed.
- [ ] Mission numbers have been checked for conflicts.
- [ ] New missions remain marked `draft: true` until verified.
- [ ] The `short` description is no longer than 100 characters.
- [ ] Descriptions include an activity, challenge, or experience rather than only describing a location.
- [ ] Required mission fields follow [SCHEMA.md](../missions/SCHEMA.md).
- [ ] Relevant themes have been selected from the supported list.
- [ ] Kid-friendly missions include a `for_kids` section when required.

### Location-Based Missions

Complete this checklist if your contribution involves a specific physical location.

- [ ] The location exists and its information has been checked.
- [ ] Coordinates point to an appropriate entrance, trailhead, parking area, or other practical arrival point.
- [ ] Coordinates use the required five-decimal-place format.
- [ ] Relevant access restrictions, permits, or reservations have been considered.
- [ ] Safety warnings are included when appropriate.
- [ ] Exact opening hours and ticket prices have not been stored in the mission file.
- [ ] The `check_ahead` fields and official website links are used where appropriate.

**Sources or verification notes (optional):**

<!-- Include official websites, maps, or other sources used to verify important details. -->

## Website, Tool, and Documentation Changes

Complete this section if you're modifying the website, Mission Manager, scripts, icons, or documentation.

**What changed?**

<!-- Describe the affected feature or component. -->

**Why was the change needed?**

<!-- Explain the problem it solves or the improvement it provides. -->

**How can someone test it?**

<!-- Provide steps to reproduce the original issue or verify the new behavior. -->

### Additional Checklist

- [ ] The change follows the project's existing conventions and visual style.
- [ ] Existing mission files and permanent IDs remain compatible.
- [ ] Relevant documentation has been updated.
- [ ] New functionality has been tested where practical.
- [ ] No unnecessary files, generated build outputs, or private information have been included.

## Testing and Validation

Please check the commands you've successfully run.

- [ ] `python tools/check_missions.py`
- [ ] `python tools/check_numbers.py`
- [ ] `bash tools/preview.sh`
- [ ] `python tools/smoke_test.py`
- [ ] Other relevant tests
- [ ] Not applicable (documentation-only or other change)

**Testing notes:**

<!-- Mention any test failures, skipped checks, or behavior that still needs verification. -->

Automated checks also run when a pull request is opened. A contribution may need adjustments before it can be merged.

## Screenshots or Examples (Optional)

If your changes affect the appearance or behavior of the website or Mission Manager, screenshots can help reviewers understand the result.

<!-- Add screenshots, examples, or before-and-after comparisons here. -->

## Originality and Licensing

Please confirm the following when applicable:

- [ ] I have the necessary rights to submit the content or code included in this contribution.
- [ ] New or modified mission content may be published under the project's CC BY-SA 4.0 mission content license.
- [ ] I have reviewed and verified any AI-assisted or externally researched content for accuracy and originality.
- [ ] I have not included copyrighted material, photographs, or other assets without the necessary permissions.
- [ ] I understand that submissions may be edited, reviewed, or declined before publication.

Mission content is licensed separately from the website code, icons, and other assets. Please contact the maintainers before submitting substantial non-mission materials if the applicable license is unclear.

## Community Packs

Community-created mission packs and public pack sharing are planned features that are still in development.

The local Mission Manager already supports creating and organizing packs, but a complete community publishing and sharing system has not yet been released.

If your pull request proposes a new official pack or changes community pack functionality, please explain the intended behavior and any compatibility considerations.

## Anything Else?

Is there anything the maintainers should know?

<!-- Additional context, concerns, limitations, or suggestions. -->

---

**Thank you for helping AmbleBee grow.**

Every new idea, correction, and improvement helps someone discover another experience worth remembering.

[Explore AmbleBee](https://amblebee.com) | [Contribution Guidelines](../CONTRIBUTING.md) | [Bee Trail](https://amblebee.com/roadmap.html)
