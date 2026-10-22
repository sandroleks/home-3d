"""Pipeline state carried between stages, stored on the scene so a saved .blend can resume."""
import json

KEY = "web_state"


def save(scene, state):
    scene[KEY] = json.dumps(state)


def load(scene):
    return json.loads(scene[KEY])
