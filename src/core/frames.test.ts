import { describe, expect, test } from "bun:test";
import { expectCelIdInvariant } from "../../tests/helpers/cel-ids.ts";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { createFrame, deleteFrame, duplicateFrame } from "./frames.ts";
import { createImage } from "./image.ts";
import {
	addLayer,
	type CelDataInit,
	createImageLayer,
	createSprite,
	framesSharingData,
	type ImageLayer,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function newData(): CelDataInit {
	return {
		image: createImage(2, 2, "rgba"),
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	};
}

function setup(frames: number) {
	const sprite = createSprite({
		width: 2,
		height: 2,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: Array.from({ length: frames }, (_, i) => 100 + i),
	});
	const plain = createImageLayer({ id: "plain", name: "plain" });
	const continuous = createImageLayer({
		id: "continuous",
		name: "continuous",
		flags: { continuous: true },
	});
	addLayer(sprite, plain, sprite.root);
	addLayer(sprite, continuous, sprite.root);
	return { sprite, plain, continuous };
}

function tag(from: number, to: number) {
	return {
		name: `${from}-${to}`,
		from,
		to,
		direction: "forward" as const,
		repeat: 0,
		userData: createUserData(),
	};
}

function framesOf(layer: ImageLayer) {
	return [...layer.cels.keys()].sort((a, b) => a - b);
}

describe("linked cels", () => {
	test("stay linked when a frame is inserted between them", () => {
		const { sprite, plain } = setup(3);
		const data = newData();
		setCel(sprite, plain, 0, data);
		setCel(sprite, plain, 2, data);
		createFrame(sprite, 1, {});
		expect(framesOf(plain)).toEqual([0, 3]);
		expect(plain.cels.get(0)?.data).toBe(plain.cels.get(3)?.data);
		expect(plain.cels.get(3)?.frame).toBe(3);
	});

	test("stay linked when an unrelated frame is deleted", () => {
		const { sprite, plain } = setup(4);
		const data = newData();
		setCel(sprite, plain, 2, data);
		setCel(sprite, plain, 3, data);
		deleteFrame(sprite, 0);
		expect(framesOf(plain)).toEqual([1, 2]);
		expect(plain.cels.get(1)?.data).toBe(plain.cels.get(2)?.data);
	});
});

describe("duplicateFrame", () => {
	test("links the new cel on a continuous layer and copies it elsewhere", () => {
		const { sprite, plain, continuous } = setup(2);
		const shared = setCel(sprite, plain, 0, newData(), 3).data;
		setCel(sprite, plain, 1, shared);
		setCel(sprite, continuous, 0, newData(), 2);
		duplicateFrame(sprite, 0);
		expect(sprite.frameDurations).toEqual([100, 100, 101]);
		expect(continuous.cels.get(1)?.data).toBe(continuous.cels.get(0)?.data);
		expect(continuous.cels.get(1)?.zIndex).toBe(2);
		const copy = plain.cels.get(1);
		expect(copy?.data).not.toBe(plain.cels.get(0)?.data);
		expect(copy?.zIndex).toBe(3);
		expect(plain.cels.get(2)?.data).toBe(shared);
	});

	test("gives the continuous copy the source's id and a plain copy a new one", () => {
		const { sprite, plain, continuous } = setup(2);
		const plainSource = setCel(sprite, plain, 0, newData()).data;
		const continuousSource = setCel(sprite, continuous, 0, newData()).data;
		duplicateFrame(sprite, 0);
		const linked = continuous.cels.get(1)?.data;
		const copied = plain.cels.get(1)?.data;
		expect(linked?.id).toBe(continuousSource.id);
		expect(copied?.id).not.toBe(plainSource.id);
		expect(framesSharingData(plain, plainSource)).toEqual([0]);
		expect(copied && framesSharingData(plain, copied)).toEqual([1]);
		expectCelIdInvariant(sprite);
	});
});

describe("tags", () => {
	test("a frame inserted right after a tag's last frame joins it", () => {
		const { sprite } = setup(4);
		sprite.tags = [tag(0, 1)];
		createFrame(sprite, 2, {});
		expect(sprite.tags.map((t) => [t.from, t.to])).toEqual([[0, 2]]);
	});

	test("a tag left empty by a deletion is removed", () => {
		const { sprite } = setup(4);
		sprite.tags = [tag(0, 3), tag(2, 2)];
		deleteFrame(sprite, 2);
		expect(sprite.tags.map((t) => [t.from, t.to])).toEqual([[0, 2]]);
	});
});

describe("undo and redo", () => {
	test("createFrame with a background colour inside a tagged range", () => {
		const { sprite, plain } = setup(4);
		addLayer(
			sprite,
			createImageLayer({
				id: "bg",
				name: "bg",
				flags: { background: true },
			}),
			sprite.root,
			0,
		);
		setCel(sprite, plain, 2, newData());
		sprite.tags = [tag(0, 3), tag(2, 3)];
		checkUndoRedo(sprite, () =>
			createFrame(sprite, 1, { background: { r: 1, g: 2, b: 3, a: 255 } }),
		);
	});

	test("duplicateFrame with a continuous layer and a plain one", () => {
		const { sprite, plain, continuous } = setup(3);
		setCel(sprite, plain, 0, newData());
		setCel(sprite, plain, 1, newData());
		setCel(sprite, continuous, 0, newData());
		checkUndoRedo(sprite, () => duplicateFrame(sprite, 0));
	});

	test("deleteFrame removing a tag and renumbering cels on two layers", () => {
		const { sprite, plain, continuous } = setup(4);
		setCel(sprite, plain, 1, newData());
		setCel(sprite, plain, 3, newData());
		setCel(sprite, continuous, 2, newData());
		setCel(sprite, continuous, 3, newData());
		sprite.tags = [tag(0, 3), tag(2, 2)];
		checkUndoRedo(sprite, () => deleteFrame(sprite, 2));
	});
});

describe("slice keys and palettes", () => {
	test("stay where they were", () => {
		const { sprite } = setup(3);
		const palette = { startFrame: 2, colors: [] };
		sprite.palettes.push(palette);
		sprite.slices = [
			{
				name: "s",
				userData: createUserData(),
				keys: [{ frame: 2, bounds: { x: 0, y: 0, width: 1, height: 1 } }],
			},
		];
		createFrame(sprite, 0, {});
		deleteFrame(sprite, 3);
		expect(sprite.slices[0]?.keys[0]?.frame).toBe(2);
		expect(sprite.palettes[1]?.startFrame).toBe(2);
	});
});
