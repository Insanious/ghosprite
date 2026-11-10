import { describe, expect, test } from "bun:test";
import { fixturePaths, readFixture } from "../../tests/helpers/ase-build.ts";
import { expectCelIdInvariant } from "../../tests/helpers/cel-ids.ts";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { createImage, getPixel, setPixel } from "./image.ts";
import {
	addLayer,
	type CelDataInit,
	cloneSprite,
	copyCelData,
	createGroupLayer,
	createImageLayer,
	createSprite,
	findLayer,
	framesSharingData,
	imageLayers,
	isLayerVisible,
	linkCels,
	removeCel,
	removeLayer,
	type Sprite,
	setCel,
	setCelOpacity,
	unlinkCel,
	walkRenderOrder,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function newSprite(mode: "rgba" | "indexed" = "rgba") {
	return createSprite({
		width: 4,
		height: 4,
		mode,
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100],
	});
}

function newData(mode: "rgba" | "indexed" = "rgba"): CelDataInit {
	return {
		image: createImage(4, 4, mode),
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	};
}

describe("createSprite", () => {
	test("sets the round-trip defaults", () => {
		const sprite = newSprite();
		expect(sprite.composeGroups).toBe(false);
		expect(sprite.pixelRatio).toEqual({ width: 1, height: 1 });
		expect(sprite.gridBounds).toEqual({ x: 0, y: 0, width: 16, height: 16 });
		expect(sprite.colorProfile).toEqual({ type: "srgb" });
	});

	test("layers have no uuid unless given one", () => {
		expect(createImageLayer({ id: "a", name: "A" }).uuid).toBeUndefined();
		expect(createGroupLayer({ id: "g", name: "G", uuid: "u" }).uuid).toBe("u");
	});
});

describe("linked cels", () => {
	test("linked cels share one userData object", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		const data = newData();
		const first = setCel(sprite, layer, 0, data);
		const second = setCel(sprite, layer, 1, data);
		first.data.userData.text = "note";
		expect(second.data.userData.text).toBe("note");
	});

	test("a pixel written through one cel shows in the other frame", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		const data = newData();
		const first = setCel(sprite, layer, 0, data);
		const second = setCel(sprite, layer, 1, data);
		setPixel(first.data.image, 1, 1, [9, 8, 7, 255]);
		expect(getPixel(second.data.image, 1, 1)).toEqual([9, 8, 7, 255]);
		expect(framesSharingData(layer, first.data)).toEqual([0, 1]);
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

function mutableObjects(root: unknown): Set<object> {
	const found = new Set<object>();
	const visit = (value: unknown) => {
		if (typeof value !== "object" || value === null || found.has(value)) return;
		found.add(value);
		if (value instanceof Map) {
			for (const [key, item] of value) {
				visit(key);
				visit(item);
			}
		} else if (!ArrayBuffer.isView(value)) {
			for (const item of Object.values(value)) visit(item);
		}
	};
	visit(root);
	return found;
}

function expectNothingShared(original: unknown, copy: unknown) {
	const originals = mutableObjects(original);
	for (const object of mutableObjects(copy)) {
		expect(originals.has(object)).toBe(false);
	}
}

function filledSprite(): Sprite {
	const sprite = createSprite({
		width: 4,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [{ r: 1, g: 2, b: 3, a: 4 }] }],
		frameDurations: [100, 200],
	});
	const group = createGroupLayer({ id: "g", name: "G", uuid: "u1" });
	addLayer(sprite, group, sprite.root);
	const layer = createImageLayer({ id: "a", name: "A", uuid: "u2" });
	addLayer(sprite, layer, group);
	const data = newData();
	data.preciseBounds = { x: 0, y: 0, width: 2, height: 2 };
	data.userData.text = "cel";
	setCel(sprite, layer, 0, data);
	layer.userData.properties.set(
		"ext",
		new Map([
			["vec", { type: "vector", value: [{ type: "bool", value: true }] }],
			[
				"nested",
				{
					type: "properties",
					value: new Map([["n", { type: "uint8", value: 3 }]]),
				},
			],
			["pt", { type: "point", value: { x: 1, y: 2 } }],
			["big", { type: "int64", value: 5n }],
		]),
	);
	sprite.tags.push({
		name: "t",
		from: 0,
		to: 1,
		direction: "forward",
		repeat: 0,
		userData: createUserData(),
	});
	sprite.slices.push({
		name: "s",
		userData: createUserData(),
		keys: [
			{
				frame: 0,
				bounds: { x: 0, y: 0, width: 2, height: 2 },
				center: { x: 1, y: 1, width: 1, height: 1 },
				pivot: { x: 1, y: 1 },
			},
		],
	});
	sprite.selections.set("sel", {
		bounds: { x: 0, y: 0, width: 2, height: 1 },
		bits: new Uint8Array([1, 1]),
	});
	sprite.colorProfile = { type: "icc", icc: new Uint8Array([1, 2, 3]) };
	return sprite;
}

describe("cloneSprite", () => {
	test("linked cels stay linked", () => {
		const sprite = createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		});
		const linked = createImageLayer({ id: "a", name: "A" });
		const other = createImageLayer({ id: "b", name: "B" });
		addLayer(sprite, linked, sprite.root);
		addLayer(sprite, other, sprite.root);
		setCel(sprite, linked, 0, newData());
		linkCels(sprite, linked, [0, 1, 2]);
		setCel(sprite, other, 0, newData());

		const copy = cloneSprite(sprite);
		const [copyLinked, copyOther] = imageLayers(copy.root);
		const shared = copyLinked?.cels.get(0)?.data;
		expect(copyLinked?.cels.get(1)?.data).toBe(shared);
		expect(copyLinked?.cels.get(2)?.data).toBe(shared);
		expect(shared).not.toBe(linked.cels.get(0)?.data);
		expect(copyOther?.cels.get(0)?.data).not.toBe(shared);

		const image = copyLinked?.cels.get(1)?.data.image;
		if (!image) throw new Error("missing image");
		setPixel(image, 1, 1, [9, 9, 9, 255]);
		expect(
			getPixel(copyLinked?.cels.get(0)?.data.image ?? image, 1, 1),
		).toEqual([9, 9, 9, 255]);
		expect(
			getPixel(copyLinked?.cels.get(2)?.data.image ?? image, 1, 1),
		).toEqual([9, 9, 9, 255]);
		expect(getPixel(linked.cels.get(0)?.data.image ?? image, 1, 1)).toEqual([
			0, 0, 0, 0,
		]);
	});

	test("shares nothing mutable with the original", () => {
		const sprite = filledSprite();
		const copy = cloneSprite(sprite);
		expect(copy).toStrictEqual(structuredClone(sprite));
		expectNothingShared(sprite, copy);
	});

	test("matches structuredClone for every fixture and keeps its links", () => {
		for (const path of fixturePaths()) {
			const { sprite } = readFixture(path);
			const copy = cloneSprite(sprite);
			expect({ path, copy }).toStrictEqual({
				path,
				copy: structuredClone(sprite),
			});
			const originalLayers = imageLayers(sprite.root);
			const copyLayers = imageLayers(copy.root);
			originalLayers.forEach((layer, i) => {
				const frames = [...layer.cels.keys()];
				for (const a of frames) {
					for (const b of frames) {
						const linkedBefore =
							layer.cels.get(a)?.data === layer.cels.get(b)?.data;
						const cels = copyLayers[i]?.cels;
						expect({
							path,
							a,
							b,
							linked: cels?.get(a)?.data === cels?.get(b)?.data,
						}).toEqual({
							path,
							a,
							b,
							linked: linkedBefore,
						});
					}
				}
			});
		}
	});
});

describe("copyCelData", () => {
	test("copies everything", () => {
		const data = { ...newData(), id: 1 };
		data.preciseBounds = { x: 0, y: 0, width: 1, height: 1 };
		const copy = copyCelData(data);
		expect(copy).toStrictEqual(data);
		expectNothingShared(data, copy);
	});
});

describe("cel data ids", () => {
	function threeFrames() {
		const sprite = createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		});
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		return { sprite, layer };
	}

	test("setCel gives new data distinct ids and keeps one id for linked frames", () => {
		const { sprite, layer } = threeFrames();
		const shared = newData();
		const first = setCel(sprite, layer, 0, shared);
		const second = setCel(sprite, layer, 1, shared);
		const other = setCel(sprite, layer, 2, newData());
		expect(second.data.id).toBe(first.data.id);
		expect(other.data.id).not.toBe(first.data.id);
		expect(framesSharingData(layer, first.data)).toEqual([0, 1]);
		expect(framesSharingData(layer, other.data)).toEqual([2]);
		expectCelIdInvariant(sprite);
	});

	test("unlinkCel gives the cel a new id and leaves the others linked", () => {
		const { sprite, layer } = threeFrames();
		setCel(sprite, layer, 0, newData());
		linkCels(sprite, layer, [0, 1, 2]);
		const before = layer.cels.get(0)?.data.id;
		expect(unlinkCel(sprite, layer, 1)).toBe(true);
		const unlinked = layer.cels.get(1)?.data;
		if (!unlinked) throw new Error("missing cel");
		expect(unlinked.id).not.toBe(before);
		expect(framesSharingData(layer, unlinked)).toEqual([1]);
		expect(layer.cels.get(0)?.data.id).toBe(before);
		expect(layer.cels.get(2)?.data.id).toBe(before);
		expectCelIdInvariant(sprite);
	});

	test("linkCels reports the canvas rect of each replaced cel", () => {
		const { sprite, layer } = threeFrames();
		setCel(sprite, layer, 0, newData());
		setCel(sprite, layer, 1, { ...newData(), x: 2, y: 1 });
		expect(linkCels(sprite, layer, [0, 1, 2])).toEqual([
			{ frame: 1, previous: { x: 2, y: 1, width: 2, height: 3 } },
			{ frame: 2, previous: undefined },
		]);
	});

	test("a clone keeps the ids and hands out ids the original cels don't have", () => {
		const { sprite, layer } = threeFrames();
		setCel(sprite, layer, 0, newData());
		linkCels(sprite, layer, [0, 1]);
		setCel(sprite, layer, 2, newData());
		const copy = cloneSprite(sprite);
		const [copyLayer] = imageLayers(copy.root);
		if (!copyLayer) throw new Error("missing layer");
		expect(copy.nextCelDataId).toBe(sprite.nextCelDataId);
		for (const [frame, cel] of layer.cels) {
			expect(copyLayer.cels.get(frame)?.data.id).toBe(cel.data.id);
		}
		const added = setCel(copy, copyLayer, 2, newData());
		expect([...layer.cels.values()].map((cel) => cel.data.id)).not.toContain(
			added.data.id,
		);
		expectCelIdInvariant(copy);
	});
});

describe("removeCel and setCelOpacity", () => {
	function linkedLayer() {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		const data = newData();
		const first = setCel(sprite, layer, 0, data);
		setCel(sprite, layer, 1, data);
		return { sprite, layer, data: first.data };
	}

	test("removeCel on one linked frame leaves the other cel with the same data", () => {
		const { sprite, layer, data } = linkedLayer();
		removeCel(sprite, layer, 0);
		expect(layer.cels.has(0)).toBe(false);
		expect(layer.cels.get(1)?.data).toBe(data);
	});

	test("setCelOpacity changes the opacity at every linked frame", () => {
		const { sprite, layer } = linkedLayer();
		setCelOpacity(sprite, layer, 0, 100);
		expect(layer.cels.get(0)?.data.opacity).toBe(100);
		expect(layer.cels.get(1)?.data.opacity).toBe(100);
	});

	test("both do nothing where there is no cel", () => {
		const sprite = newSprite();
		const layer = createImageLayer({ id: "a", name: "A" });
		removeCel(sprite, layer, 3);
		setCelOpacity(sprite, layer, 3, 10);
		expect(layer.cels.size).toBe(0);
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

describe("undo of cel and layer writes", () => {
	function threeFrameSprite() {
		const sprite = createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		});
		const layer = createImageLayer({ id: "a", name: "A" });
		addLayer(sprite, layer, sprite.root);
		return { sprite, layer };
	}

	function spriteWithGroup() {
		const { sprite } = threeFrameSprite();
		const group = createGroupLayer({ id: "g", name: "G" });
		addLayer(sprite, group, sprite.root);
		addLayer(sprite, createImageLayer({ id: "c", name: "C" }), group);
		return { sprite, group };
	}

	test("addLayer into a group", () => {
		const { sprite, group } = spriteWithGroup();
		checkUndoRedo(sprite, () =>
			addLayer(sprite, createImageLayer({ id: "d", name: "D" }), group, 0),
		);
	});

	test("removeLayer of a group with children", () => {
		const { sprite, group } = spriteWithGroup();
		checkUndoRedo(sprite, () => removeLayer(sprite, group));
	});

	test("a remove then add at another index", () => {
		const { sprite } = spriteWithGroup();
		const first = sprite.root.children[0];
		if (!first) throw new Error("missing layer");
		checkUndoRedo(sprite, () => {
			removeLayer(sprite, first);
			addLayer(sprite, first, sprite.root, 1);
		});
	});

	test("setCel over an existing cel", () => {
		const { sprite, layer } = threeFrameSprite();
		setCel(sprite, layer, 0, newData());
		checkUndoRedo(sprite, () => setCel(sprite, layer, 0, newData()));
	});

	test("setCel into an empty frame", () => {
		const { sprite, layer } = threeFrameSprite();
		setCel(sprite, layer, 0, newData());
		checkUndoRedo(sprite, () => setCel(sprite, layer, 2, newData()));
	});

	test("removeCel in the middle of the map brings the key order back", () => {
		const { sprite, layer } = threeFrameSprite();
		for (const frame of [0, 1, 2]) setCel(sprite, layer, frame, newData());
		checkUndoRedo(sprite, () => removeCel(sprite, layer, 1));
	});

	test("setCelOpacity on a linked cel", () => {
		const { sprite, layer } = threeFrameSprite();
		setCel(sprite, layer, 0, newData());
		linkCels(sprite, layer, [0, 1]);
		checkUndoRedo(sprite, () => setCelOpacity(sprite, layer, 1, 10));
	});

	test("unlinkCel brings back one shared object with the original id", () => {
		const { sprite, layer } = threeFrameSprite();
		setCel(sprite, layer, 0, newData());
		linkCels(sprite, layer, [0, 1, 2]);
		checkUndoRedo(sprite, () => unlinkCel(sprite, layer, 1));
		expect(layer.cels.get(0)?.data).toBe(layer.cels.get(1)?.data);
		expect(layer.cels.get(2)?.data).toBe(layer.cels.get(1)?.data);
	});

	test("linkCels over frames that had their own cels", () => {
		const { sprite, layer } = threeFrameSprite();
		for (const frame of [0, 1, 2]) setCel(sprite, layer, frame, newData());
		checkUndoRedo(sprite, () => linkCels(sprite, layer, [0, 1, 2]));
	});
});
