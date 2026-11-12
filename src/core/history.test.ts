import { describe, expect, test } from "bun:test";
import { spriteWithLinkedCels } from "../../tests/helpers/linked-cels.ts";
import { checkUndoRedo, expectSameSprite } from "../../tests/helpers/undo.ts";
import {
	abortStep,
	beginStep,
	discardRedo,
	endStep,
	recordCelData,
	recordCels,
	recordChildren,
	recordHeader,
	recordLayer,
	recordPalettes,
	recordSelections,
	recordSlices,
	recordTags,
	redoStep,
	undoBytes,
	undoStep,
} from "./history.ts";
import { createImage, setPixel } from "./image.ts";
import {
	cloneSprite,
	createGroupLayer,
	createImageLayer,
	newCelDataId,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

const plainError = expect.objectContaining({ name: "Error" });

function richSprite() {
	const { sprite, layer } = spriteWithLinkedCels();
	sprite.tags.push({
		name: "walk",
		from: 0,
		to: 1,
		direction: "forward",
		repeat: 0,
		userData: createUserData(),
	});
	sprite.slices.push({
		name: "s",
		userData: createUserData(),
		keys: [{ frame: 0, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
	});
	sprite.selections.set("a", {
		bounds: { x: 0, y: 0, width: 1, height: 1 },
		bits: new Uint8Array([1]),
	});
	return { sprite, layer };
}

function steps(sprite: Sprite, ...writes: (() => void)[]) {
	beginStep(sprite);
	for (const write of writes) write();
	endStep(sprite);
}

describe("entry kinds", () => {
	test("header", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordHeader(sprite);
			sprite.width = 9;
			sprite.height = 7;
			sprite.frameDurations.push(50);
		});
	});

	test("palettes", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordPalettes(sprite);
			sprite.palettes[0]?.colors.push({ r: 1, g: 2, b: 3, a: 4 });
			sprite.palettes.push({ startFrame: 1, colors: [] });
		});
	});

	test("tags", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordTags(sprite);
			sprite.tags = [];
		});
	});

	test("slices", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordSlices(sprite);
			sprite.slices.push({
				name: "t",
				userData: createUserData(),
				keys: [],
			});
		});
	});

	test("selections", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordSelections(sprite);
			sprite.selections.set("b", {
				bounds: { x: 1, y: 1, width: 1, height: 1 },
				bits: new Uint8Array([1]),
			});
		});
	});

	test("children", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordChildren(sprite, sprite.root);
			sprite.root.children.splice(
				0,
				1,
				createGroupLayer({ id: "g", name: "G" }),
			);
		});
	});

	test("layer", () => {
		const { sprite, layer } = richSprite();
		checkUndoRedo(sprite, () => {
			recordLayer(sprite, layer);
			layer.opacity = 10;
			layer.blendMode = "multiply";
		});
	});

	test("cels", () => {
		const { sprite, layer } = richSprite();
		checkUndoRedo(sprite, () => {
			recordCels(sprite, layer);
			layer.cels.delete(0);
			setCel(sprite, layer, 0, {
				image: createImage(1, 1, "rgba"),
				x: 0,
				y: 0,
				opacity: 255,
				userData: createUserData(),
			});
			layer.cels = new Map([...layer.cels].reverse());
		});
	});

	test("celData", () => {
		const { sprite, layer } = richSprite();
		const data = layer.cels.get(0)?.data;
		if (!data) throw new Error("no cel");
		checkUndoRedo(sprite, () => {
			recordCelData(sprite, data);
			data.image = createImage(2, 2, "rgba");
			data.x = 4;
			data.y = 5;
			data.opacity = 3;
			data.userData.text = "changed";
			data.preciseBounds = { x: 1, y: 1, width: 1, height: 1 };
		});
		expect("preciseBounds" in data).toBe(false);
	});

	test("celData with preciseBounds deleted", () => {
		const { sprite, layer } = richSprite();
		const data = layer.cels.get(0)?.data;
		if (!data) throw new Error("no cel");
		data.preciseBounds = { x: 1, y: 1, width: 1, height: 1 };
		checkUndoRedo(sprite, () => {
			recordCelData(sprite, data);
			delete data.preciseBounds;
		});
		expect(data.preciseBounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
	});
});

describe("steps", () => {
	test("records of the same thing undo to the state before the first", () => {
		const { sprite } = richSprite();
		checkUndoRedo(sprite, () => {
			recordTags(sprite);
			sprite.tags = [];
			recordTags(sprite);
			sprite.tags = [
				{
					name: "x",
					from: 0,
					to: 0,
					direction: "reverse",
					repeat: 1,
					userData: createUserData(),
				},
			];
			recordTags(sprite);
			sprite.tags.pop();
		});
	});

	test("a three-entry step survives repeated undo and redo", () => {
		const { sprite, layer } = richSprite();
		const before = cloneSprite(sprite);
		steps(
			sprite,
			() => {
				recordHeader(sprite);
				sprite.width = 8;
			},
			() => {
				recordLayer(sprite, layer);
				layer.opacity = 1;
			},
			() => {
				recordTags(sprite);
				sprite.tags = [];
			},
		);
		const after = cloneSprite(sprite);
		for (let i = 0; i < 3; i++) {
			undoStep(sprite);
			expectSameSprite(sprite, before);
			redoStep(sprite);
			expectSameSprite(sprite, after);
		}
	});

	test("a recorded copy is not changed by a later in-place write", () => {
		const { sprite } = richSprite();
		beginStep(sprite);
		recordTags(sprite);
		const tag = sprite.tags[0];
		if (!tag) throw new Error("no tag");
		tag.from = 1;
		endStep(sprite);
		undoStep(sprite);
		expect(sprite.tags[0]?.from).toBe(0);
	});

	test("nothing is recorded without an open step", () => {
		const { sprite, layer } = richSprite();
		recordHeader(sprite);
		recordTags(sprite);
		recordCels(sprite, layer);
		const data = layer.cels.get(0)?.data;
		if (data) recordCelData(sprite, data);
		expect(undoBytes(sprite)).toBe(0);
		expect(() => undoStep(sprite)).toThrow(plainError);
	});

	test("abortStep restores the sprite and leaves nothing to undo", () => {
		const { sprite } = richSprite();
		const before = cloneSprite(sprite);
		beginStep(sprite);
		recordHeader(sprite);
		sprite.width = 99;
		abortStep(sprite);
		expectSameSprite(sprite, before);
		expect(() => undoStep(sprite)).toThrow(plainError);
	});

	test("open and closed steps guard each other", () => {
		const { sprite } = richSprite();
		beginStep(sprite);
		expect(() => beginStep(sprite)).toThrow(plainError);
		expect(() => undoStep(sprite)).toThrow(plainError);
		expect(() => redoStep(sprite)).toThrow(plainError);
		endStep(sprite);
		undoStep(sprite);
		discardRedo(sprite);
		expect(() => redoStep(sprite)).toThrow(plainError);
	});

	test("an aborted step leaves redo working", () => {
		const { sprite } = richSprite();
		steps(sprite, () => {
			recordHeader(sprite);
			sprite.width = 8;
		});
		undoStep(sprite);
		beginStep(sprite);
		recordHeader(sprite);
		sprite.width = 50;
		abortStep(sprite);
		expect(sprite.width).toBe(3);
		redoStep(sprite);
		expect(sprite.width).toBe(8);
	});

	test("endStep needs the redo steps discarded", () => {
		const { sprite } = richSprite();
		steps(sprite, () => {
			recordHeader(sprite);
			sprite.width = 8;
		});
		undoStep(sprite);
		beginStep(sprite);
		expect(() => endStep(sprite)).toThrow(plainError);
		discardRedo(sprite);
		endStep(sprite);
	});

	test("restoring a deleted cel keeps the map's key order", () => {
		const { sprite, layer } = richSprite();
		checkUndoRedo(sprite, () => {
			recordCels(sprite, layer);
			layer.cels.delete(0);
		});
		expect([...layer.cels.keys()]).toEqual([0, 1]);
	});

	test("nextCelDataId follows undo and redo", () => {
		const { sprite } = richSprite();
		const old = sprite.nextCelDataId;
		steps(sprite, () => {
			newCelDataId(sprite);
			newCelDataId(sprite);
		});
		expect(sprite.nextCelDataId).toBe(old + 2);
		undoStep(sprite);
		expect(sprite.nextCelDataId).toBe(old);
		redoStep(sprite);
		expect(sprite.nextCelDataId).toBe(old + 2);
	});

	test("undoBytes counts the images celData entries hold", () => {
		const { sprite, layer } = richSprite();
		const data = layer.cels.get(0)?.data;
		if (!data) throw new Error("no cel");
		const bytes = data.image.data.byteLength;
		steps(sprite, () => {
			recordCelData(sprite, data);
			data.image = createImage(1, 1, "rgba");
			setPixel(data.image, 0, 0, [1, 2, 3, 4]);
		});
		expect(undoBytes(sprite)).toBe(bytes);
	});

	test("a layer added with createImageLayer is untouched by unrelated records", () => {
		const { sprite } = richSprite();
		const extra = createImageLayer({ id: "l2", name: "L2" });
		checkUndoRedo(sprite, () => {
			recordChildren(sprite, sprite.root);
			sprite.root.children.push(extra);
		});
		expect(sprite.root.children).not.toContain(extra);
	});
});
