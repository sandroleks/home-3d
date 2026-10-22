"""Export the apartment for the web walkthrough.

    blender -b <file.blend> --python-exit-code 1 --python blender/export_web.py -- --quality preview
    blender -b build/web-export.blend --python blender/export_web.py -- --stage bake --quality final
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from pipeline import config, run  # noqa: E402


def parse_args(argv):
    p = argparse.ArgumentParser(prog="export_web")
    p.add_argument("--quality", choices=sorted(config.QUALITY), default="preview")
    p.add_argument("--out", default="web/public/assets")
    p.add_argument("--build", default="build")
    p.add_argument("--stage", choices=("all", "bake", "export"), default="all")
    return p.parse_args(argv)


def main():
    args = parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    out_dir, build_dir = os.path.abspath(args.out), os.path.abspath(args.build)
    quality = config.QUALITY[args.quality]
    scene = bpy.context.scene
    if args.stage == "all":
        errors = run.run_all(args.quality, out_dir, build_dir)
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
