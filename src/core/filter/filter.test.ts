import { describe, expect, test } from "bun:test";
import { copyImage, createImage, getPixel, type Image } from "../image.ts";
import { filterCanvas } from "./filter.ts";
import { invert } from "./invert.ts";

const all = { r: true, g: true, b: true, a: true };

function filledImage(size: number): Image {
	const image = createImage(size, size, "rgba");
	for (let i = 0; i < image.data.length; i++) image.data[i] = (i * 7) % 256;
	return image;
}

function inverted(pixel: number[]): number[] {
	return pixel.map((value) => value ^ 0xff);
}

describe("filterCanvas", () => {
	test("filters every pixel of the area and leaves the rest untouched", () => {
		const image = filledImage(4);
		const original = copyImage(image);
		const area = { x: 1, y: 1, width: 2, height: 2 };

		filterCanvas({ image, x: 0, y: 0 }, invert, area, all, {
			x: 0,
			y: 0,
			width: 4,
			height: 4,
		});

		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const before = getPixel(original, x, y);
				const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
				expect(getPixel(image, x, y)).toEqual(
					inside ? inverted(before) : before,
				);
			}
		}
	});

	test("with a mask, pixels the mask leaves out keep their bytes, alpha included", () => {
		const image = filledImage(4);
		const original = copyImage(image);
		const mask = {
			bounds: { x: 0, y: 0, width: 4, height: 4 },
			bits: new Uint8Array(16),
		};
		mask.bits[1 * 4 + 1] = 1;
		mask.bits[2 * 4 + 2] = 1;

		filterCanvas(
			{ image, x: 0, y: 0 },
			invert,
			{ x: 0, y: 0, width: 4, height: 4 },
			all,
			{ x: 0, y: 0, width: 4, height: 4 },
			mask,
		);

		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				const before = getPixel(original, x, y);
				const masked = x === y && (x === 1 || x === 2);
				expect(getPixel(image, x, y)).toEqual(
					masked ? inverted(before) : before,
				);
			}
		}
	});

	test("a cel hanging off the top-left lines the mask up in sprite space", () => {
		const image = filledImage(5);
		const original = copyImage(image);
		const mask = {
			bounds: { x: 2, y: 2, width: 2, height: 1 },
			bits: Uint8Array.of(1, 0),
		};

		filterCanvas(
			{ image, x: -1, y: -1 },
			invert,
			{ x: 2, y: 2, width: 2, height: 1 },
			all,
			{ x: 0, y: 0, width: 4, height: 4 },
			mask,
		);

		const changed: string[] = [];
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 5; x++) {
				const before = getPixel(original, x, y);
				if (getPixel(image, x, y).join() !== before.join()) {
					changed.push(`${x},${y}`);
				}
			}
		}
		expect(changed).toEqual(["3,3"]);
	});
});
