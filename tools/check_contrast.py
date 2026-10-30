"""Check that the site's text colors are readable, in light and dark mode.

    python tools/check_contrast.py

Reads the color tokens from site/style.css and tests every text-on-background pair below against
the 4.5:1 minimum for normal-size text (WCAG AA). Add a pair here when a new color is used for text.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIN_RATIO = 4.5
WHITE = "#FFFDF8"  # the light text on solid sage

PAPERS = ["oat", "linen", "paper", "sand", "honey-tint"]
PAIRS = [(fg, bg) for fg in ("sage-deep", "walnut", "walnut-soft", "ink") for bg in PAPERS]
PAIRS += [("sage-ink", "sage-tint"), ("honey-deep", "paper"), (WHITE, "fill"), (WHITE, "fill-hover"),
          ("foot-ink", "foot-bg"), ("foot-link", "foot-bg")]


def tokens(block):
    return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", block))


def luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4 for v in channels]
    return .2126 * r + .7152 * g + .0722 * b


def ratio(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + .05) / (lo + .05)


def main():
    css = (ROOT / "site" / "style.css").read_text(encoding="utf-8")
    light = tokens(re.search(r":root \{(.*?)\n\}", css, re.S).group(1))
    dark = {**light, **tokens(re.search(r"prefers-color-scheme: dark\) \{\s*:root \{(.*?)\n\s*\}", css, re.S).group(1))}
    problems = []
    for mode, colors in (("light", light), ("dark", dark)):
        for fg, bg in PAIRS:
            a, b = colors.get(fg, fg), colors[bg]
            if ratio(a, b) < MIN_RATIO:
                problems.append(f"{mode}: {fg} on {bg} is {ratio(a, b):.2f}:1 ({a} on {b}); needs {MIN_RATIO}:1")
    if problems:
        raise SystemExit("Text that's too hard to read:\n  - " + "\n  - ".join(problems))
    print(f"Contrast OK: {len(PAIRS)} color pairs pass in light and dark mode")


if __name__ == "__main__":
    sys.exit(main())
