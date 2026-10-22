"""Run the pipeline's unittest suite inside Blender.

    blender -b --factory-startup --python-exit-code 1 --python blender/tests/run.py -- [pattern]
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # blender/
sys.path.insert(0, ROOT)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pattern = argv[0] if argv else "test_*.py"
suite = unittest.defaultTestLoader.discover(HERE, pattern=pattern, top_level_dir=ROOT)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
