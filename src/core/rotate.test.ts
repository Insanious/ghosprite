import { describe, expect, test } from "bun:test";
import {
	opaquePixels,
	selectedPixels,
	spriteWithSelectedShape,
} from "../../tests/helpers/selection-fixture.ts";
import { createImage, getPixel, setPixel } from "./image.ts";
import { rotateImage, rotateSprite } from "./rotate.ts";

describe("rotateSprite selections", () => {
	test.each([90, 180, 270] as const)(
		"%i keeps a selection over its pixels",
		(angle) => {
			const sprite = spriteWithSelectedShape();
			rotateSprite(sprite, angle);
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

describe("rotateImage", () => {
	test("a 3x2 image rotated 90 is 2x3 with the top row on the right", () => {
		const out = rotateImage(sample(), 90);
		expect([out.width, out.height]).toEqual([2, 3]);
		expect(getPixel(out, 1, 0)).toEqual([0, 0, 0, 255]);
		expect(getPixel(out, 1, 2)).toEqual([2, 0, 0, 255]);
		expect(getPixel(out, 0, 0)).toEqual([0, 1, 0, 255]);
	});

	test("270 puts the top row on the left, reversed", () => {
		const out = rotateImage(sample(), 270);
		expect([out.width, out.height]).toEqual([2, 3]);
		expect(getPixel(out, 0, 2)).toEqual([0, 0, 0, 255]);
		expect(getPixel(out, 0, 0)).toEqual([2, 0, 0, 255]);
	});

	test("180 keeps the size and reverses the pixels", () => {
		const out = rotateImage(sample(), 180);
		expect([out.width, out.height]).toEqual([3, 2]);
		expect(getPixel(out, 0, 0)).toEqual([2, 1, 0, 255]);
	});

	test("four quarter turns restore the image", () => {
		let image = sample();
		for (let i = 0; i < 4; i++) image = rotateImage(image, 90);
		expect(image).toEqual(sample());
	});

	test("90 then 270 restores the image", () => {
		expect(rotateImage(rotateImage(sample(), 90), 270)).toEqual(sample());
	});
});
