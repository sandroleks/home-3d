"""Pipeline settings. Override tables at the bottom are for hand fixes after reviewing build/debug_map.png."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Quality:
    name: str
    albedo_texels_per_m: int
    albedo_max: int
    lightmap_texels_per_m: int
    lightmap_min: int
    lightmap_max: int
    door_lightmap: int
    bake_samples: int
    blur_sigma_px: float
    movable_tile: int  # px per drawer or cupboard door in its room's atlas
    pack_scale: float  # packed lamp layers on a room, relative to its lightmap


QUALITY = {
    "test": Quality("test", 16, 64, 8, 32, 64, 32, 4, 0.0, 32, 0.5),
    "preview": Quality("preview", 64, 1024, 24, 256, 1024, 128, 32, 1.0, 64, 0.5),
    "final": Quality("final", 256, 2048, 100, 512, 2048, 512, 512, 1.0, 192, 0.5),
}

EYE_HEIGHT = 1.6
PLAYER_RADIUS = 0.2
GRID_CELL = 0.05
COLLISION_SAMPLE_HEIGHTS = (0.3, 1.0, 1.7)
COLLISION_RAY_TOP = 2.0
LOW_OBJECT_MAX_Z = 0.1
SWITCH_HEIGHT = 1.1
SWITCH_OFFSET_FROM_OPENING = 0.15
SWITCH_SIZE = (0.086, 0.012, 0.086)  # plate width, thickness, height
SPAWN_CAMERA = "Cam_Entrada"
VIEWPOINT_CAMERAS = ("Cam_Sala", "Cam_Kitchen", "Cam_Bedroom")
FIRST_VIEW_BUDGET_BYTES = 30 * 1024 * 1024
# Leaf 5 (infilled opening 20) was deleted from the model; a leaf on an infilled opening is still dropped. The three
# glazed doors have two leaves each.
EXPECTED_DOOR_COUNT = 15
# Chunking: faces over a wall (no floor below) join the nearest room within this distance;
# meshes with faces larger than DICE_MAX_FACE_AREA m² are first cut on a DICE_CELL grid.
ROOM_ASSIGN_MAX_DIST = 0.2
DICE_CELL = 0.25
DICE_MAX_FACE_AREA = 0.5

DROP_OBJECT_NAMES = ("Walls (backup before finishes)",)
# Collections (and their sub-collections) seen through the windows. They are kilometre-scale, so
# instead of being chunked and lightmapped they go to surroundings.glb, which the viewer lights live.
SURROUNDINGS_COLLECTION_PREFIXES = ("Exterior - neighbourhood",)
FORCE_INCLUDE_COLLECTION_PREFIXES = ("Ceiling",)
PASSABLE_NAME_PATTERN = r"^Glazed Door .* (glass|mullion|rail)(\.\d+)?$"
# Custom properties the model uses (blender/tools/model_details.py writes them; README lists them).
LAMP_PROP = "web_lamp"  # on a light and its fixtures: the lamp group, switched apart from the room's wall switch
SCREEN_PROP = "web_screen"  # "tv" | "monitor" | "laptop"
MOVE_PROP = "web_move"  # "slide" (web_dir, web_dist) | "hinge" (web_pivot, web_axis, web_angle)
LEAF_PROP = "web_leaf"  # a part joined into the named door leaf (French door glass)
# The light a screen casts, baked for an all-white picture (W); the viewer scales it by the picture's brightness.
SCREEN_LIGHT_WATTS = {"tv": 100.0, "monitor": 20.0}
# Movables baked together must be at least this far apart (m), so one open front doesn't shade the other's bake.
MOVABLE_PASS_DISTANCE = 0.8
# Packed lamp layers: three to a texture, at most this many textures on one surface.
MAX_PACKS = 3

# {"Door leaf 3": {"hinge": "b", "sign": -1}}: hinge end "a" is the end with the smaller (x, z).
DOOR_OVERRIDES = {
    # French doors open as pairs into the room with the space: Quarto 02 (not the balcony), the kitchen, the laundry.
    "Door leaf 4a": {"sign": -1}, "Door leaf 4b": {"sign": 1},
    "Door leaf 24a": {"sign": 1}, "Door leaf 24b": {"sign": -1},
    "Door leaf 26a": {"sign": 1}, "Door leaf 26b": {"sign": -1},
}
# {"cozinha": {"door": 24, "side": -1}}: door number from the lintel name, side along the wall
# (an explicit side skips the furniture-clearance test); "face": "outside" uses the other room's face.
SWITCH_OVERRIDES = {
    # Door 20 (Cozinha / Entrada) is infilled; the only other opening is Glazed Door 24, whose
    # east side runs into the Sala wall. West side: on the wall above the worktop (0.9 m).
    "cozinha": {"door": 24, "side": -1},
    # No free wall inside these doorways (closet shelving; broom cupboard, washer/dryer), so the
    # switch goes on the other room's face: in the Entrada east of opening 18 (west of it the open
    # front door stands in front), and on the Marquise side of glazed door 26 east of it, above a
    # bistro chair (0.94 m), since the Marquise's own switch takes the clear west side.
    "closet": {"door": 18, "face": "outside", "side": 1},
    "lavandaria": {"door": 26, "face": "outside", "side": 1},
    # Latch side: the default (+1) spot is on the hinge side, between the open leaf and the wall.
    "quarto-01": {"door": 6, "side": -1},
    "quarto-02": {"door": 9, "side": -1},
}

# Where the flat is: Blender's origin, and the compass bearing of Blender +Y. Measured by matching the model's
# neighbourhood to OpenStreetMap outlines (docs/superpowers/specs/2026-10-23-sun-simulation-design.md).
SITE = {"lat": 41.117327, "lon": -8.653914, "timeZone": "Europe/Lisbon", "yBearing": 142.1}
# Real W/m² to the scene's light units. Calibrated against Cycles references so a daylight interior matches the
# exposure of the old renders (8x the old Sun lamp's 4 per 900 W/m²); the sun-to-sky ratio stays physical.
WATTS_TO_SCENE = 32.0 / 900.0
# The day layer bakes sky light only. The world's colour is replaced by this flat sky (the Sky Texture has a sun of its
# own built in) at the world's own strength, and only lights named DAY_FILL_LIGHT_PREFIX stay on.
SKY_BAKE_COLOR = (0.55, 0.70, 0.95)
DAY_FILL_LIGHT_PREFIX = "Portal "
# Lamps on a wall, and lampshades, can sit just outside their room's floor polygon.
LAMP_ROOM_MAX_DIST = 0.5
