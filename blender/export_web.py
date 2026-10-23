"""Export the apartment for the web walkthrough (Blender 5.1 or newer).

Run it through the Makefile, never by pointing Blender at files in ~/Documents:

    make export-preview     # about 1 minute
    make export-final       # about 35 minutes on the GPU
    make export-surroundings  # about 1 minute: only the neighbourhood seen through the windows

The Makefile stages a copy of the code and the .blend in /private/tmp and runs Blender there with
factory settings (--factory-startup), so personal add-ons never load. Baking uses the GPU; set
WEB_BAKE_DEVICE=CPU to force the (much slower) CPU, e.g. `WEB_BAKE_DEVICE=CPU make export-final`.

Underlying command, as run inside the staging folder:

    blender -b --factory-startup source.blend --python-exit-code 1 --python blender/export_web.py -- --quality preview
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from pipeline import checks, config, run, surroundings  # noqa: E402


def parse_args(argv):
    p = argparse.ArgumentParser(prog="export_web")
    p.add_argument("--quality", choices=sorted(config.QUALITY), default="preview")
    p.add_argument("--out", default="web/public/assets")
    p.add_argument("--build", default="build")
    p.add_argument("--stage", choices=("all", "bake", "export", "surroundings"), default="all")
    return p.parse_args(argv)


def main():
    if tuple(bpy.app.version) < (5, 1, 0):
        print("This pipeline needs Blender 5.1 or newer; found %d.%d.%d" % tuple(bpy.app.version))
        sys.exit(1)
    args = parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    out_dir, build_dir = os.path.abspath(args.out), os.path.abspath(args.build)
    quality = config.QUALITY[args.quality]
    scene = bpy.context.scene
    if args.stage == "all":
        errors = run.run_all(args.quality, out_dir, build_dir)
    elif args.stage == "surroundings":
        names = surroundings.export_surroundings(scene, bpy.context.view_layer, quality, out_dir)
        errors = checks.check_surroundings(out_dir) if names else [f"no meshes in {config.SURROUNDINGS_COLLECTION_PREFIXES}"]
    else:
        if args.stage == "bake":
            run.bake_stage(scene, quality, out_dir)
        errors = run.export_stage(scene, out_dir, config.EXPECTED_DOOR_COUNT, config.FIRST_VIEW_BUDGET_BYTES)
    if errors:
        print("\nEXPORT CHECKS FAILED:", *errors, sep="\n  - ", flush=True)
        sys.exit(1)
    print(f"\nExport OK → {out_dir}", flush=True)


if __name__ == "__main__":
    main()
