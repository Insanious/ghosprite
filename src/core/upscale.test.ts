import { describe, expect, test } from "bun:test";
import { createImage, getPixel, setPixel } from "./image.ts";
import { upscale } from "./upscale.ts";

function sample() {
	const image = createImage(2, 2, "rgba");
	setPixel(image, 0, 0, [255, 0, 0, 255]);
	setPixel(image, 1, 0, [0, 255, 0, 255]);
	setPixel(image, 0, 1, [0, 0, 255, 255]);
	return image;
}

describe("upscale", () => {
	test("scale 3 copies each pixel into a 3x3 block", () => {
		const src = sample();
		const out = upscale(src, 3, false);
		expect([out.width, out.height]).toEqual([6, 6]);
		for (let y = 0; y < 6; y++) {
			for (let x = 0; x < 6; x++) {
				expect(getPixel(out, x, y)).toEqual(
					getPixel(src, Math.floor(x / 3), Math.floor(y / 3)),
				);
			}
		}
	});

	test("grid at scale 4 draws lines at multiples of 4 and keeps cell interiors", () => {
		const src = sample();
		const out = upscale(src, 4, true);
		expect([out.width, out.height]).toEqual([9, 9]);
		for (let y = 0; y < 9; y++) {
			for (let x = 0; x < 9; x++) {
				const onLine = x % 4 === 0 || y % 4 === 0;
				if (onLine) {
					expect(getPixel(out, x, y)).not.toEqual(
						getPixel(
							src,
							Math.min(Math.floor(x / 4), 1),
							Math.min(Math.floor(y / 4), 1),
						),
					);
				} else {
					expect(getPixel(out, x, y)).toEqual(
						getPixel(src, Math.floor(x / 4), Math.floor(y / 4)),
					);
				}
			}
		}
	});

	test("grid over transparent pixels is the grid colour itself", () => {
		const out = upscale(createImage(1, 1, "rgba"), 4, true);
		expect(getPixel(out, 0, 0)).toEqual([128, 128, 128, 128]);
	});

	test("throws for scale below 1 and for a grid below scale 4", () => {
		expect(() => upscale(sample(), 0, false)).toThrow();
		expect(() => upscale(sample(), 3, true)).toThrow();
	});
});
