#!/usr/bin/env python3
"""Suggests themes for missions from their existing free-form tags.

    python tools/suggest_themes.py                 show suggestions for missions that have no themes yet
    python tools/suggest_themes.py --pack oregon   only one pack
    python tools/suggest_themes.py --write         add a `themes: [...]` line to those mission files

Only missions without a themes line are touched, so it never overwrites themes you've picked by hand.
The line goes just above `tags:`; nothing else in the file changes (comments and order stay as they are).
Suggestions are a starting point: read them over when you verify each mission, and add or drop
themes the tags didn't catch. Run python tools/check_missions.py afterwards.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from missions_lib import THEMES, THEMES_MAX, load_catalog  # noqa: E402

# theme -> old tags that mean it. Tags not listed here (city names, rainy-day, free, kids, night...) are
# left alone on purpose: they repeat a field (setting, cost, who, time_of_day) or a place.
TAGS_FOR = {
    "views": """views skyline overlook observation-deck lookout city-lights viewpoint scenic ocean-views sea-
        stacks summit fire-tower tower""",
    "hiking": """hiking hike trails easy-hike short-hikes switchbacks quick-climb scrambling rock-scramble
        appalachian-trail timberline-trail superior-hiking-trail ice-age-trail skyline-trail wilderness""",
    "walks": """walking walk boardwalk greenway stroll town-square""",
    "waterfalls": """waterfall waterfalls falls-park""",
    "beach": """beach coast ocean pier tide-pools dunes lighthouse island islands shells waves national-seashore
        beach-towns gulf-coast""",
    "lakes-rivers": """lake lakes river creek bay waterfront lakefront alpine-lakes dam canal canals swamp everglades
        marsh mangroves""",
    "mountains": """mountains mountain alpine high-altitude high-peaks volcanoes""",
    "deserts": """desert high-desert saguaro""",
    "swimming": """swimming springs hot-springs swimming-hole soak mineral-springs pool wading geothermal""",
    "boating": """boat boats ferry kayak kayaking canoe paddling paddleboard tubing rafting whitewater sailing
        snorkeling cruise airboat float-trip boating""",
    "caves": """cave caves caving underground lava-tubes tunnels tunnel grotto""",
    "rocks-fossils": """geology fossils volcano canyon canyons rocks arch cliffs gorge dinosaurs mammoths glacier
        glaciers slot-canyon granite badlands sinkhole gems""",
    "forests": """fall-color fall-colors forest trees redwoods old-growth sequoia sequoias rainforest woods
        cypress""",
    "parks": """national-park state-park national-monument national-forest national-memorial""",
    "wildlife": """wildlife animals birds zoo aquarium alligators dolphins whales manatees bison turtles sea-
        turtles otters seals sea-lions elk bats eagles raptors birding crocodiles sharks horses cats
        dogs fish koi salmon cows farm farms longhorns safari bugs wild-horses""",
    "gardens": """gardens garden flowers wildflowers conservatory roses greenhouse""",
    "stars": """stars dark-sky astronomy telescope stargazing space rockets nasa planetarium space-coast""",
    "biking": """biking rail-trail mountain-biking""",
    "picnic": """picnic""",
    "sunsets": """sunset sunrise""",
    "history": """history historic fort mansion mansions civil-war revolutionary-war ghost-town ruins gilded-age
        oregon-trail gold-rush route-66 presidents monuments military estate shipwreck medieval native-
        american""",
    "museums": """museum""",
    "science": """science inventions hands-on interactive engineering""",
    "art": """art sculpture murals street-art glass glass-art stained-glass tiffany immersive-art folk-art""",
    "architecture": """architecture bridge frank-lloyd-wright house-tour castle skyscraper art-deco covered-bridge""",
    "vehicles": """aviation trains train cars racing hot-rods planes airport railroad trolley streetcar ships ship
        flying engines simulators""",
    "spooky": """spooky ghosts mystery halloween prison ufo""",
    "food": """food dinner seafood bakery sweets ice-cream coffee bbq brunch food-trucks pizza fudge chocolate
        pie oysters breakfast steak sushi food-hall food-crawl cafe hot-sauce baking""",
    "drinks": """nightlife wine drinks cocktails brewery bourbon cider beer tasting vineyard bar 21+ wine-country""",
    "markets": """market shopping thrifting farmers-market antiques bookstore books""",
    "movies": """movies cinema movie indie-film classic-films arthouse""",
    "shows": """music jazz theater comedy live-music concert dancing blues honky-tonk improv standup show
        puppets circus live-radio listening-room songwriters""",
    "games": """games arcade bowling puzzles escape-room mini-golf competitive game-night game scavenger-hunt
        treasure-hunt strategy""",
    "thrills": """rides theme-park thrill roller-coasters zipline amusement-park canopy-tour ropes-course climbing
        bouldering""",
    "quirky": """quirky roadside retro neon surreal mermaids""",
    "holidays": """holiday holiday-lights christmas festival mardi-gras pumpkins corn-maze fair rodeo fireworks""",
    "road-trips": """scenic-drive road-trip""",
    "playful": """playful silly dress-up role-play party surprise costumes""",
    "romantic": """romantic date-night anniversary""",
    "relaxing": """calm cozy relaxing quiet unplugged""",
    "small-towns": """small-town village""",
    "make-something": """creative crafts craft build make-something painting drawing cooking writing movie-making dye
        cardboard class new-skill learn-something juggling learning try-something-new""",
}
TAG_TO_THEME = {tag: theme for theme, words in TAGS_FOR.items() for tag in words.split()}


def suggest(m):
    found = {TAG_TO_THEME[str(t)] for t in (m.get("tags") or []) if str(t) in TAG_TO_THEME}
    return [t for t in THEMES if t in found][:THEMES_MAX]   # in the theme list's order


def add_line(path, themes):
    text = Path(path).read_text(encoding="utf-8")
    line = f"themes: [{', '.join(themes)}]\n"
    for key in ("tags", "credit"):
        mt = re.search(rf"^{key}:", text, re.M)
        if mt:
            text = text[:mt.start()] + line + text[mt.start():]
            break
    else:
        text = text.rstrip("\n") + "\n" + line
    Path(path).write_text(text, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--missions", default=str(ROOT / "missions"))
    ap.add_argument("--pack", help="only this pack folder (oregon, anywhere ...)")
    ap.add_argument("--write", action="store_true", help="add the themes line to the files")
    args = ap.parse_args()
    bad = sorted({t for t in TAGS_FOR if t not in THEMES})
    if bad:
        raise SystemExit(f"TAGS_FOR has themes that aren't in missions_lib.THEMES: {bad}")

    folder = Path(args.missions)
    _, _, missions = load_catalog(folder)
    todo = [m for m in missions if "themes" not in m and (not args.pack or m["pack"] == args.pack)]
    done, empty = 0, []
    for m in sorted(todo, key=lambda m: (m["pack"], m["number"] if isinstance(m["number"], int) else 0)):
        rel = Path(m["file"]).relative_to(folder)
        themes = suggest(m)
        if not themes:
            empty.append(rel)
            continue
        print(f"{rel}: themes: [{', '.join(themes)}]")
        if args.write:
            add_line(m["file"], themes)
            done += 1
    print(f"\n{len(todo) - len(empty)} of {len(todo)} missions without themes got a suggestion"
          + (f"; wrote {done} files" if args.write else " (nothing written; add --write to save them)"))
    if empty:
        print(f"No suggestion for {len(empty)} (none of their tags map to a theme); pick by hand:")
        for rel in empty:
            print(f"  - {rel}")


if __name__ == "__main__":
    main()
