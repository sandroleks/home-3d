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

.PHONY: test-blender export-preview export-final export-surroundings render-refs web-test

test-blender:
	$(SYNC)
	$(IN_STAGE) -b --factory-startup --python-exit-code 1 --python blender/tests/run.py -- $(TESTS)

export-preview export-final: export-%:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && rm -rf $(STAGE)/out
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/export_web.py -- --quality $* --out out/assets --build out/build
	mkdir -p $(OUT) $(BUILD) && rsync -a --delete --exclude audio/ --exclude climate.json --exclude DATA-SOURCES.md $(STAGE)/out/assets/ $(OUT)/ && rsync -a $(STAGE)/out/build/ $(BUILD)/

# Only the neighbourhood seen through the windows: no bake, and the other assets stay as they are.
export-surroundings:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && rm -rf $(STAGE)/out
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/export_web.py -- --quality final --stage surroundings --out out/assets --build out/build
	mkdir -p $(OUT) && cp $(STAGE)/out/assets/surroundings.glb $(OUT)/

# Cycles renders of the viewpoints. SUN=2026-12-21T10:00 (Lisbon time) lights them like the viewer at that
# moment: the real sun and the month's typical sky, with lamps off.
render-refs:
	$(SYNC) && cp "$(SOURCE)" $(STAGE)/source.blend && cp web/public/assets/climate.json $(STAGE)/climate.json && mkdir -p $(STAGE)/ref
	$(IN_STAGE) -b --factory-startup source.blend --python-exit-code 1 --python blender/render_refs.py -- --out ref $(if $(SUN),--sun $(SUN) --climate climate.json)
	mkdir -p $(BUILD)/ref && rsync -a $(STAGE)/ref/ $(BUILD)/ref/

web-test:
	cd web && npm test
