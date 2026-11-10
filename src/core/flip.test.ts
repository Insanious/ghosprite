import { describe, expect, test } from "bun:test";
import { spriteWithLinkedCels } from "../../tests/helpers/linked-cels.ts";
import {
	opaquePixels,
	selectedPixels,
	spriteWithSelectedShape,
} from "../../tests/helpers/selection-fixture.ts";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { wholeSprite } from "../../tests/helpers/whole-sprite.ts";
import { flipImage, flipSprite } from "./flip.ts";
import { createImage, getPixel, setPixel } from "./image.ts";

describe("flipSprite linked cels", () => {
	test("a cel linked across frames is flipped once", () => {
		const { sprite, layer } = spriteWithLinkedCels();
		flipSprite(sprite, "horizontal");
		const data = layer.cels.get(0)?.data;
		if (!data) throw new Error("no cel");
		expect(getPixel(data.image, 2, 0)).toEqual([9, 8, 7, 255]);
		expect(layer.cels.get(1)?.data).toBe(data);
	});
});

describe("flipSprite selections", () => {
	test.each(["horizontal", "vertical"] as const)(
		"%s keeps a selection over its pixels",
		(direction) => {
			const sprite = spriteWithSelectedShape();
			flipSprite(sprite, direction);
			expect(selectedPixels(sprite, "selection-1")).toEqual(
				opaquePixels(sprite),
			);
		},
	);
});

function sample() {
	const image = createImage(3, 2, "rgba");
	for (let y = 0; y < 2; y++) {
		for (let x = 0; x < 3; x++) setPixel(image, x, y, [x, y, 0, 255]);
	}
	return image;
}

describe("flipImage", () => {
	test("horizontal mirrors columns, keeping the middle one", () => {
		const image = sample();
		flipImage(image, "horizontal");
		expect(getPixel(image, 0, 0)).toEqual([2, 0, 0, 255]);
		expect(getPixel(image, 1, 0)).toEqual([1, 0, 0, 255]);
		expect(getPixel(image, 2, 1)).toEqual([0, 1, 0, 255]);
	});

	test("vertical mirrors rows", () => {
		const image = sample();
		flipImage(image, "vertical");
		expect(getPixel(image, 0, 0)).toEqual([0, 1, 0, 255]);
		expect(getPixel(image, 2, 1)).toEqual([2, 0, 0, 255]);
	});

	test("flipping twice restores the image", () => {
		const image = sample();
		flipImage(image, "horizontal");
		flipImage(image, "horizontal");
		flipImage(image, "vertical");
		flipImage(image, "vertical");
		expect(image.data).toEqual(sample().data);
	});

	test("indexed images flip one byte per pixel", () => {
		const image = createImage(2, 1, "indexed");
		setPixel(image, 0, 0, [5]);
		setPixel(image, 1, 0, [7]);
		flipImage(image, "horizontal");
		expect(Array.from(image.data)).toEqual([7, 5]);
	});
});

describe("flipSprite undo", () => {
	test.each(["horizontal", "vertical"] as const)(
		"undo and redo restore a %s flip",
		(direction) => {
			const { sprite } = wholeSprite();
			checkUndoRedo(sprite, () => flipSprite(sprite, direction));
		},
	);
});
