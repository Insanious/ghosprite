import { describe, expect, test } from "bun:test";
import { createImage, getPixel, setPixel } from "./image.ts";
import { resizeImage } from "./resize.ts";

describe("resizeImage", () => {
	test("1x1 to 3x2 repeats the pixel", () => {
		const src = createImage(1, 1, "rgba");
		setPixel(src, 0, 0, [9, 8, 7, 255]);
		const out = resizeImage(src, 3, 2);
		expect([out.width, out.height]).toEqual([3, 2]);
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 3; x++) {
				expect(getPixel(out, x, y)).toEqual([9, 8, 7, 255]);
			}
		}
	});

	test("4x4 to 2x2 keeps every other pixel", () => {
		const src = createImage(4, 4, "indexed");
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) setPixel(src, x, y, [y * 4 + x]);
		}
		const out = resizeImage(src, 2, 2);
		expect([0, 1, 2, 3].map((i) => out.data[i])).toEqual([0, 2, 8, 10]);
	});
});
