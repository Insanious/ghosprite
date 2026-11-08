import { expect, test } from "bun:test";
import { tileImages } from "./contact-sheet.ts";
import { createImage, getPixel } from "./image.ts";

function opaque(width: number, height: number) {
	const image = createImage(width, height, "rgba");
	image.data.fill(255);
	return image;
}

test("three 2x2 images in 2 columns with gap 1 give a 5x5 sheet", () => {
	const { image, rects } = tileImages(
		[opaque(2, 2), opaque(2, 2), opaque(2, 2)],
		2,
		1,
	);
	expect([image.width, image.height]).toEqual([5, 5]);
	expect(rects).toEqual([
		{ x: 0, y: 0, width: 2, height: 2 },
		{ x: 3, y: 0, width: 2, height: 2 },
		{ x: 0, y: 3, width: 2, height: 2 },
	]);
	expect(getPixel(image, 1, 1)).toEqual([255, 255, 255, 255]);
	expect(getPixel(image, 2, 0)[3]).toBe(0);
	expect(getPixel(image, 0, 2)[3]).toBe(0);
	expect(getPixel(image, 4, 4)[3]).toBe(0);
});
