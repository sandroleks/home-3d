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


QUALITY = {
    "test": Quality("test", 16, 64, 8, 32, 64, 32, 4, 0.0),
    "preview": Quality("preview", 64, 1024, 24, 256, 1024, 128, 32, 1.0),
    "final": Quality("final", 256, 2048, 100, 512, 2048, 512, 512, 1.0),
}

EYE_HEIGHT = 1.6
PLAYER_RADIUS = 0.2
GRID_CELL = 0.05
COLLISION_SAMPLE_HEIGHTS = (0.3, 1.0, 1.7)
COLLISION_RAY_TOP = 2.0
LOW_OBJECT_MAX_Z = 0.1
SWITCH_HEIGHT = 1.1
SWITCH_OFFSET_FROM_OPENING = 0.15
SWITCH_SIZE = (0.08, 0.01, 0.08)
SPAWN_CAMERA = "Cam_Entrada"
VIEWPOINT_CAMERAS = ("Cam_Sala", "Cam_Kitchen", "Cam_Bedroom")
FIRST_VIEW_BUDGET_BYTES = 30 * 1024 * 1024
EXPECTED_DOOR_COUNT = 9  # 10 leaves; leaf 5 sits on the infilled opening 20 and is removed
# Chunking: faces over a wall (no floor below) join the nearest room within this distance;
# meshes with faces larger than DICE_MAX_FACE_AREA m² are first cut on a DICE_CELL grid.
ROOM_ASSIGN_MAX_DIST = 0.2
DICE_CELL = 0.25
DICE_MAX_FACE_AREA = 0.5

DROP_OBJECT_NAMES = ("Walls (backup before finishes)",)
FORCE_INCLUDE_COLLECTION_PREFIXES = ("Ceiling",)
PASSABLE_NAME_PATTERN = r"^Glazed Door .* (glass|mullion|rail)(\.\d+)?$"

# {"Door leaf 3": {"hinge": "b", "sign": -1}}: hinge end "a" is the end with the smaller (x, z).
DOOR_OVERRIDES = {}
# {"cozinha": {"door": 24, "side": -1}}: door number from the lintel name, side along the wall.
SWITCH_OVERRIDES = {
    # Door 20 (Cozinha / Entrada) is infilled; the only other opening is Glazed Door 24, whose
    # east side runs into the Sala wall. West side: on the wall above the worktop (0.9 m).
    "cozinha": {"door": 24, "side": -1},
}
