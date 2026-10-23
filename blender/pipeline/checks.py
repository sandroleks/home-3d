"""Self-checks that run after every export; any message means the export is not usable."""
import json
import os
import re
import struct

from . import geom, manifest as manifest_mod


def read_glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError(f"{path} is not a GLB file")
    length, kind = struct.unpack_from("<I4s", data, 12)
    if kind != b"JSON":
        raise ValueError(f"{path}: first chunk is not JSON")
    return json.loads(data[20:20 + length])


def sanitized_node_name(name):
    """Mirror three.js PropertyBinding.sanitizeNodeName (what GLTFLoader does to node names)."""
    return re.sub(r"[\[\]\\.:/]", "", re.sub(r"\s", "_", name))


def check_outputs(out_dir, m, budget_bytes, expected_doors):
    errors = list(manifest_mod.validate_manifest(m))
    refs = [c["day"] for c in m["chunks"]] + [c["light"] for c in m["chunks"]] + [d["lightmap"] for d in m["doors"]]
    for ref in refs:
        if ref and not os.path.exists(os.path.join(out_dir, ref["file"])):
            errors.append(f"missing file {ref['file']}")
    for name in ("apartment.glb", "collision.json", "manifest.json"):
        if not os.path.exists(os.path.join(out_dir, name)):
            errors.append(f"missing file {name}")
    if errors:
        return errors
    all_names = [c["node"] for c in m["chunks"]] + [d["node"] for d in m["doors"]] + [
        r["switch"] for r in m["rooms"] if r["switch"]]
    for name in all_names:
        clean = sanitized_node_name(name)
        if clean != name:
            errors.append(f"node name {name!r} changes to {clean!r} in three.js")
    if len(m["doors"]) != expected_doors:
        errors.append(f"expected {expected_doors} doors, found {len(m['doors'])}")
    gltf = read_glb_json(os.path.join(out_dir, "apartment.glb"))
    nodes = {n["name"]: n for n in gltf["nodes"]}
    for name in [c["node"] for c in m["chunks"]] + [d["node"] for d in m["doors"]]:
        node = nodes.get(name)
        if node is None or "mesh" not in node:
            errors.append(f"glb has no mesh node {name}")
            continue
        scale, rot = node.get("scale"), node.get("rotation")
        if (scale is not None and any(abs(a - 1.0) > 1e-4 for a in scale)) or (
                rot is not None and any(abs(a - b) > 1e-4 for a, b in zip(rot, (0.0, 0.0, 0.0, 1.0)))):
            errors.append(f"glb node {name} has a non-identity scale/rotation")
        for p in gltf["meshes"][node["mesh"]]["primitives"]:
            if "TEXCOORD_1" not in p["attributes"]:
                errors.append(f"glb node {name}: a primitive lacks TEXCOORD_1 (lightmap UVs)")
                break
    for sw in [r["switch"] for r in m["rooms"] if r["switch"]]:
        if sw not in nodes:
            errors.append(f"glb has no switch node {sw}")
    first_view = ["apartment.glb", "collision.json", "manifest.json"] + [c["day"]["file"] for c in m["chunks"]] + [
        d["lightmap"]["file"] for d in m["doors"]
    ]
    errors += check_surroundings(out_dir)
    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in first_view)
    if total > budget_bytes:
        errors.append(f"first-view download is {total / 1048576:.1f} MB, budget {budget_bytes / 1048576:.0f} MB")
    return errors


def check_surroundings(out_dir):
    """surroundings.glb is optional, but when present every primitive needs normals: the viewer lights it live."""
    path = os.path.join(out_dir, "surroundings.glb")
    if not os.path.exists(path):
        return []
    for mesh in read_glb_json(path)["meshes"]:
        if any("NORMAL" not in p["attributes"] for p in mesh["primitives"]):
            return [f"surroundings.glb mesh {mesh.get('name')!r}: a primitive lacks NORMAL"]
    return []


def check_scene(state):
    import bpy

    from .proc_materials import is_procedural

    errors = []
    names = [c["node"] for c in state["chunks"]] + [d["node"] for d in state["doors"]]
    for name in names:
        obj = bpy.data.objects[name]
        if [l.name for l in obj.data.uv_layers] != ["UVMap", "UVLightmap"]:
            errors.append(f"{name}: UV maps are {[l.name for l in obj.data.uv_layers]}")
        for slot in obj.material_slots:
            mat = slot.material
            if is_procedural(mat):
                errors.append(f"{name}: material {mat.name} is still procedural")
                continue
            bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat else None
            if bsdf and bsdf.inputs["Base Color"].is_linked:
                src = bsdf.inputs["Base Color"].links[0].from_node.type
                if src != "TEX_IMAGE":
                    errors.append(f"{name}: material {mat.name} base colour comes from {src}, which glTF cannot export")
    for d in state["doors"]:
        loc = bpy.data.objects[d["node"]].location
        bx, by = geom.from_three_xz(*d["hinge"])
        if abs(loc.x - bx) > 1e-3 or abs(loc.y - by) > 1e-3:
            errors.append(f"{d['node']}: origin is not at its hinge")
    for msg in state.get("lost_lamps", []):
        errors.append(f"lamp or glowing object {msg}: move it into a room with a ceiling light")
    return errors
