import { describe, expect, test } from "bun:test";
import {
	copyImage,
	createImage,
	getPixel,
	intersectRects,
	isEmptyRect,
	setPixel,
	unionRects,
} from "./image.ts";

describe("image", () => {
	test("allocates bytes per mode", () => {
		expect(createImage(3, 2, "rgba").data.length).toBe(24);
		expect(createImage(3, 2, "grayscale").data.length).toBe(12);
		expect(createImage(3, 2, "indexed").data.length).toBe(6);
	});

	test("rgba pixels land on four bytes", () => {
		const image = createImage(2, 2, "rgba");
		setPixel(image, 1, 1, [1, 2, 3, 4]);
		expect([...image.data.subarray(12, 16)]).toEqual([1, 2, 3, 4]);
		expect(getPixel(image, 1, 1)).toEqual([1, 2, 3, 4]);
		expect(getPixel(image, 0, 0)).toEqual([0, 0, 0, 0]);
	});

	test("grayscale pixels land on value and alpha", () => {
		const image = createImage(2, 2, "grayscale");
		setPixel(image, 1, 0, [7, 200]);
		expect([...image.data.subarray(2, 4)]).toEqual([7, 200]);
		expect(getPixel(image, 1, 0)).toEqual([7, 200]);
	});

	test("indexed pixels land on one byte", () => {
		const image = createImage(2, 2, "indexed");
		setPixel(image, 0, 1, [9]);
		expect(image.data[2]).toBe(9);
		expect(getPixel(image, 0, 1)).toEqual([9]);
	});

	test("rejects out-of-bounds coordinates and wrong byte counts", () => {
		const image = createImage(2, 2, "rgba");
		expect(() => getPixel(image, 2, 0)).toThrow(RangeError);
		expect(() => setPixel(image, 0, -1, [0, 0, 0, 0])).toThrow(RangeError);
		expect(() => setPixel(image, 0, 0, [1])).toThrow(RangeError);
	});

	test("copy is independent", () => {
		const image = createImage(1, 1, "indexed");
		const copy = copyImage(image);
		setPixel(copy, 0, 0, [5]);
		expect(getPixel(image, 0, 0)).toEqual([0]);
	});
});

describe("rect", () => {
	test("intersect with negative origins", () => {
		expect(
			intersectRects(
				{ x: -5, y: -5, width: 10, height: 10 },
				{ x: -2, y: 1, width: 10, height: 10 },
			),
		).toEqual({ x: -2, y: 1, width: 7, height: 4 });
	});

	test("disjoint and touching rects intersect to empty", () => {
		const a = { x: 0, y: 0, width: 4, height: 4 };
		expect(
			isEmptyRect(intersectRects(a, { x: 10, y: 10, width: 2, height: 2 })),
		).toBe(true);
		expect(
			isEmptyRect(intersectRects(a, { x: 4, y: 0, width: 2, height: 2 })),
		).toBe(true);
	});

	test("union covers both and ignores empty rects", () => {
		expect(
			unionRects(
				{ x: -1, y: 0, width: 2, height: 2 },
				{ x: 3, y: -4, width: 1, height: 1 },
			),
		).toEqual({ x: -1, y: -4, width: 5, height: 6 });
		const a = { x: 2, y: 2, width: 3, height: 3 };
		expect(unionRects(a, { x: 0, y: 0, width: 0, height: 5 })).toEqual(a);
	});
});
