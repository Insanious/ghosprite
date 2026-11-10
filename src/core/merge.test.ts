import { expect, test } from "bun:test";
import { expectCelIdInvariant } from "../../tests/helpers/cel-ids.ts";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { wholeSprite } from "../../tests/helpers/whole-sprite.ts";
import { createImage, setPixel } from "./image.ts";
import { flattenSprite, mergeLayerDown } from "./merge.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	imageLayers,
	linkCels,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function pixelData(x: number) {
	const image = createImage(2, 2, "rgba");
	setPixel(image, 0, 0, [200, 0, 0, 255]);
	return { image, x, y: 0, opacity: 255, userData: createUserData() };
}

function twoLayers() {
	const sprite = createSprite({
		width: 4,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100],
	});
	const lower = createImageLayer({ id: "lower", name: "Lower" });
	const upper = createImageLayer({ id: "upper", name: "Upper" });
	addLayer(sprite, lower, sprite.root);
	addLayer(sprite, upper, sprite.root);
	setCel(sprite, lower, 0, pixelData(0));
	linkCels(sprite, lower, [0, 1]);
	setCel(sprite, upper, 0, pixelData(1));
	setCel(sprite, upper, 1, pixelData(2));
	return { sprite, lower, upper };
}

test("mergeLayerDown leaves every cel with an id, none repeated across data", () => {
	const { sprite, lower, upper } = twoLayers();
	mergeLayerDown(sprite, upper, lower);
	const ids = [0, 1].map((frame) => lower.cels.get(frame)?.data.id);
	expect(ids[0]).toBeDefined();
	expect(ids[1]).not.toBe(ids[0]);
	expectCelIdInvariant(sprite);
});

test("flattenSprite leaves every cel with an id, none repeated across data", () => {
	const { sprite } = twoLayers();
	const target = createImageLayer({ id: "flat", name: "Flat" });
	flattenSprite(sprite, target);
	const [flat] = imageLayers(sprite.root);
	const ids = [0, 1].map((frame) => flat?.cels.get(frame)?.data.id);
	expect(ids[0]).toBeDefined();
	expect(ids[1]).not.toBe(ids[0]);
	expectCelIdInvariant(sprite);
});

test("undo and redo restore a merge down", () => {
	const { sprite, background, top } = wholeSprite();
	checkUndoRedo(sprite, () => {
		mergeLayerDown(sprite, top, background);
	});
});

test("undo and redo restore a flatten into the background layer", () => {
	const { sprite, background } = wholeSprite();
	checkUndoRedo(sprite, () => {
		flattenSprite(sprite, background);
	});
});

test("undo and redo restore a flatten into a new layer", () => {
	const { sprite } = wholeSprite();
	checkUndoRedo(sprite, () => {
		flattenSprite(sprite, createImageLayer({ id: "flat", name: "Flat" }));
	});
});
