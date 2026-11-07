import { describe, expect, test } from "bun:test";
import { createImage, getPixel, setPixel } from "./image.ts";
import {
	addLayer,
	type CelData,
	createGroupLayer,
	createImageLayer,
	createSprite,
	findLayer,
	framesSharingData,
	isLayerVisible,
	setCel,
	walkRenderOrder,
} from "./sprite.ts";

function newSprite(mode: "rgba" | "indexed" = "rgba") {
	return createSprite({
		width: 4,
		height: 4,
		mode,
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100],
	});
}

function newData(mode: "rgba" | "indexed" = "rgba"): CelData {
	return { image: createImage(4, 4, mode), x: 0, y: 0, opacity: 255 };
}

describe("linked cels", () => {
	test("a pixel written through one cel shows in the other frame", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		const data = newData();
		const first = setCel(sprite, layer, 0, data);
		const second = setCel(sprite, layer, 1, data);
		setPixel(first.data.image, 1, 1, [9, 8, 7, 255]);
		expect(getPixel(second.data.image, 1, 1)).toEqual([9, 8, 7, 255]);
		expect(framesSharingData(layer, data)).toEqual([0, 1]);
	});

	test("zIndex is per cel", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		const data = newData();
		const first = setCel(sprite, layer, 0, data);
		const second = setCel(sprite, layer, 1, data);
		first.zIndex = 3;
		expect(second.zIndex).toBe(0);
	});
});

describe("setCel", () => {
	test("rejects an image in the wrong colour mode", () => {
		const sprite = newSprite("indexed");
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		expect(() => setCel(sprite, layer, 0, newData("rgba"))).toThrow(RangeError);
	});

	test("rejects a frame the sprite does not have", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		expect(() => setCel(sprite, layer, 2, newData())).toThrow(RangeError);
	});
});

describe("visibility", () => {
	test("a child of a hidden group is hidden even when visible itself", () => {
		const sprite = newSprite();
		const group = createGroupLayer({
			id: "g",
			name: "G",
			flags: { visible: false },
		});
		const child = createImageLayer({ id: "c", name: "C" });
		addLayer(sprite, group, sprite.root);
		addLayer(sprite, child, group);
		expect(child.flags.visible).toBe(true);
		expect(isLayerVisible(sprite, child)).toBe(false);
	});

	test("a visible layer in a visible group is visible", () => {
		const sprite = newSprite();
		const group = createGroupLayer({ id: "g", name: "G" });
		const child = createImageLayer({ id: "c", name: "C" });
		addLayer(sprite, group, sprite.root);
		addLayer(sprite, child, group);
		expect(isLayerVisible(sprite, child)).toBe(true);
	});
});

describe("background layer", () => {
	const background = (id: string, init = {}) =>
		createImageLayer({ id, name: id, flags: { background: true }, ...init });

	test("accepts one at the bottom of the root", () => {
		const sprite = newSprite();
		addLayer(sprite, createImageLayer({ id: "a", name: "A" }), sprite.root);
		addLayer(sprite, background("bg"), sprite.root, 0);
		expect(sprite.root.children[0]?.id).toBe("bg");
	});

	test("rejects a second one", () => {
		const sprite = newSprite();
		addLayer(sprite, background("bg1"), sprite.root, 0);
		expect(() => addLayer(sprite, background("bg2"), sprite.root, 0)).toThrow(
			RangeError,
		);
	});

	test("rejects one above another layer", () => {
		const sprite = newSprite();
		addLayer(sprite, createImageLayer({ id: "a", name: "A" }), sprite.root);
		expect(() => addLayer(sprite, background("bg"), sprite.root)).toThrow(
			RangeError,
		);
	});

	test("rejects one inside a group", () => {
		const sprite = newSprite();
		const group = createGroupLayer({ id: "g", name: "G" });
		addLayer(sprite, group, sprite.root);
		expect(() => addLayer(sprite, background("bg"), group, 0)).toThrow(
			RangeError,
		);
	});

	test("rejects opacity 0 and multiply blend", () => {
		const sprite = newSprite();
		expect(() =>
			addLayer(sprite, background("bg", { opacity: 0 }), sprite.root, 0),
		).toThrow(RangeError);
		expect(() =>
			addLayer(
				sprite,
				background("bg", { blendMode: "multiply" }),
				sprite.root,
				0,
			),
		).toThrow(RangeError);
	});

	test("rejects a layer added below it", () => {
		const sprite = newSprite();
		addLayer(sprite, background("bg"), sprite.root, 0);
		expect(() =>
			addLayer(
				sprite,
				createImageLayer({ id: "a", name: "A" }),
				sprite.root,
				0,
			),
		).toThrow(RangeError);
	});
});

describe("layer tree", () => {
	test("rejects a duplicate id", () => {
		const sprite = newSprite();
		addLayer(sprite, createImageLayer({ id: "a", name: "A" }), sprite.root);
		expect(() =>
			addLayer(sprite, createImageLayer({ id: "a", name: "B" }), sprite.root),
		).toThrow(RangeError);
	});

	test("findLayer finds nested layers", () => {
		const sprite = newSprite();
		const group = createGroupLayer({ id: "g", name: "G" });
		const child = createImageLayer({ id: "c", name: "C" });
		addLayer(sprite, group, sprite.root);
		addLayer(sprite, child, group);
		expect(findLayer(sprite, "c")).toBe(child);
		expect(findLayer(sprite, "zzz")).toBeUndefined();
	});

	test("render order visits a group's children between the layers below and above", () => {
		const sprite = newSprite();
		const group = createGroupLayer({ id: "g", name: "G" });
		addLayer(sprite, createImageLayer({ id: "below", name: "" }), sprite.root);
		addLayer(sprite, group, sprite.root);
		addLayer(sprite, createImageLayer({ id: "above", name: "" }), sprite.root);
		addLayer(sprite, createImageLayer({ id: "in1", name: "" }), group);
		addLayer(sprite, createImageLayer({ id: "in2", name: "" }), group);
		const ids = [...walkRenderOrder(sprite.root)].map((layer) => layer.id);
		expect(ids).toEqual(["below", "g", "in1", "in2", "above"]);
	});
});
