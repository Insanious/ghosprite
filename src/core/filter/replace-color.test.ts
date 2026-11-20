import { describe, expect, test } from "bun:test";
import { createImage, getPixel, type Image, setPixel } from "../image.ts";
import { filterCanvas } from "./filter.ts";
import { replaceColor } from "./replace-color.ts";

const all = { r: true, g: true, b: true, a: true };
const bounds = { x: 0, y: 0, width: 3, height: 1 };

const A = { r: 10, g: 20, b: 30, a: 255 };
const B = { r: 200, g: 100, b: 50, a: 255 };
const C = { r: 0, g: 255, b: 0, a: 255 };

function row(...pixels: number[][]): Image {
	const image = createImage(pixels.length, 1, "rgba");
	pixels.forEach((pixel, x) => {
		setPixel(image, x, 0, pixel);
	});
	return image;
}

const bytes = (c: typeof A) => [c.r, c.g, c.b, c.a];

describe("replaceColor", () => {
	test("two pairs A to B and B to A swap A and B and leave C", () => {
		const image = row(bytes(A), bytes(B), bytes(C));
		const filter = replaceColor(
			[
				{ from: A, to: B },
				{ from: B, to: A },
			],
			0,
		);
		filterCanvas({ image, x: 0, y: 0 }, filter, bounds, all, bounds);
		expect(getPixel(image, 0, 0)).toEqual(bytes(B));
		expect(getPixel(image, 1, 0)).toEqual(bytes(A));
		expect(getPixel(image, 2, 0)).toEqual(bytes(C));
	});

	test("the first of two matching pairs wins", () => {
		const image = row(bytes(A));
		const near = { ...A, r: 12 };
		const filter = replaceColor(
			[
				{ from: near, to: B },
				{ from: A, to: C },
			],
			5,
		);
		filterCanvas({ image, x: 0, y: 0 }, filter, bounds, all, bounds);
		expect(getPixel(image, 0, 0)).toEqual(bytes(B));
	});

	test("with channels limited to r, a pair matches on red alone and writes only red", () => {
		const image = row([10, 20, 30, 255]);
		const filter = replaceColor(
			[{ from: { r: 10, g: 0, b: 0, a: 0 }, to: { r: 99, g: 1, b: 2, a: 3 } }],
			0,
		);
		filterCanvas(
			{ image, x: 0, y: 0 },
			filter,
			bounds,
			{ r: true, g: false, b: false, a: false },
			bounds,
		);
		expect(getPixel(image, 0, 0)).toEqual([99, 20, 30, 255]);
	});
});
