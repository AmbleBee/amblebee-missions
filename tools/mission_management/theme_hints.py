"""Theme suggestions from a mission's words: the mission manager colors these chips blue as you write,
and tools/suggest_themes.py fills in missing themes in bulk. One word list for both.

Each theme lists tags (and words) that mean it. Words that repeat a field (free, kids, night, rainy-day) are
left out on purpose: those have their own filters.
"""

from amble_checks import THEMES, THEMES_MAX

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
    """Themes for a mission from its tags (the bulk tool's rule: tags only, so its picks stay conservative)."""
    found = {TAG_TO_THEME[str(t)] for t in (m.get("tags") or []) if str(t) in TAG_TO_THEME}
    return [t for t in THEMES if t in found][:THEMES_MAX]   # in the theme list's order




def hints():
    """{word or tag: theme}, for the manager's live suggestions (it also matches words in the name and text)."""
    return dict(TAG_TO_THEME)
