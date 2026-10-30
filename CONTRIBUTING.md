# Contributing

## The easy way

No GitHub needed:

- [Suggest a mission](https://forms.gle/V8UZRwmDrLwzQpuM6)
- Report a problem with the link at the bottom of any mission on [amblebee.com](https://amblebee.com)
- Anything else: staff@amblebee.com

## Adding a mission with a pull request

1. Copy `missions/_template.yaml` into the right pack folder, like `missions/oregon/`.
2. Name it after the mission, in lowercase with dashes, like `blue-pool-hike.yaml`.
3. Run `python tools/check_numbers.py` to find the next free number in that pack.
4. Fill it in. [SCHEMA.md](missions/SCHEMA.md) explains every field.
5. Run `python tools/check_missions.py` and fix anything it finds.
6. Open a pull request. Add `credit:` with your name if you'd like to be credited. The pull request opens with a short checklist; tick what applies.

## A few rules

- New missions start as `draft: true`, and stay hidden until the pin, address and details are checked.
- File names and numbers are permanent. Never rename a published mission or reuse a number.
- If two pull requests pick the same number, the second one gets renumbered when it's merged. Numbers are permanent once a mission is published, but not before.
- Never store hours or prices, because they go stale. Use `check_ahead` and link to the place's website.
- Only list discounts a place advertises, and never amounts.
- Contributions to `missions/` are shared under [CC BY-SA 4.0](LICENSE).
