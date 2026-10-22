BLENDER ?= /Applications/Blender.app/Contents/MacOS/Blender
SOURCE ?= Untitled.blend
OUT := web/public/assets
BUILD := build
# Blender must never touch ~/Documents: when a Blender launched from Claude reaches into it,
# macOS blocks the whole session's file access. Code and the .blend are copied to STAGE,
# Blender runs there with HOME redirected, and outputs are copied back.
STAGE := /private/tmp/apartment-walkthrough-blender
SYNC = mkdir -p $(STAGE)/home && rsync -a --delete blender $(wildcard shared) $(STAGE)/
IN_STAGE = cd $(STAGE) && HOME=$(STAGE)/home "$(BLENDER)"

.PHONY: test-blender export-preview export-final render-refs web-test

test-blender:
	$(SYNC)
	$(IN_STAGE) -b --factory-startup --python-exit-code 1 --python blender/tests/run.py -- $(TESTS)

export-preview export-final: export-%:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && rm -rf $(STAGE)/out
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/export_web.py -- --quality $* --out out/assets --build out/build
	mkdir -p $(OUT) $(BUILD) && rsync -a --delete $(STAGE)/out/assets/ $(OUT)/ && rsync -a $(STAGE)/out/build/ $(BUILD)/

render-refs:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && mkdir -p $(STAGE)/ref
	for cam in Cam_Sala Cam_Kitchen Cam_Bedroom; do $(IN_STAGE) -b --factory-startup source.blend --python-expr "import bpy; s=bpy.context.scene; s.camera=bpy.data.objects['$$cam']; s.render.resolution_percentage=50; s.render.filepath='$(STAGE)/ref/$$cam'" -f 1 || exit 1; done
	mkdir -p $(BUILD)/ref && rsync -a $(STAGE)/ref/ $(BUILD)/ref/

web-test:
	cd web && npm test
