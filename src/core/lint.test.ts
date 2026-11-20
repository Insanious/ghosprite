import { describe, expect, test } from "bun:test";
import { CoreError } from "./errors.ts";
import { createImage, setPixel } from "./image.ts";
import { colorUsage, nearColorPairs, strayPixels } from "./lint.ts";

const rgba = (r: number, g: number, b: number, a = 255) => ({ r, g, b, a });

describe("strayPixels", () => {
	test("a lone pixel is stray", () => {
		const image = createImage(5, 5, "rgba");
		setPixel(image, 2, 2, [1, 2, 3, 255]);
		expect(strayPixels(image)).toEqual([{ x: 2, y: 2 }]);
	});

	test("a diagonal touch is not stray", () => {
		const image = createImage(5, 5, "rgba");
		setPixel(image, 1, 1, [1, 2, 3, 255]);
		setPixel(image, 2, 2, [1, 2, 3, 255]);
		expect(strayPixels(image)).toEqual([]);
	});

	test("orthogonal neighbours are not stray", () => {
		const image = createImage(5, 5, "rgba");
		setPixel(image, 1, 1, [1, 2, 3, 255]);
		setPixel(image, 2, 1, [1, 2, 3, 255]);
		expect(strayPixels(image)).toEqual([]);
	});

	test("edge and corner pixels are stray, in row-major order", () => {
		const image = createImage(4, 4, "rgba");
		setPixel(image, 3, 3, [1, 2, 3, 255]);
		setPixel(image, 0, 0, [1, 2, 3, 255]);
		setPixel(image, 3, 1, [1, 2, 3, 255]);
		expect(strayPixels(image)).toEqual([
			{ x: 0, y: 0 },
			{ x: 3, y: 1 },
			{ x: 3, y: 3 },
		]);
	});

	test("a neighbour with alpha 0 and non-zero RGB does not count", () => {
		const image = createImage(3, 3, "rgba");
		setPixel(image, 1, 1, [1, 2, 3, 255]);
		setPixel(image, 2, 1, [200, 100, 50, 0]);
		expect(strayPixels(image)).toEqual([{ x: 1, y: 1 }]);
	});

	test("rejects a grayscale image", () => {
		expect(() => strayPixels(createImage(2, 2, "grayscale"))).toThrow(
			CoreError,
		);
		try {
			strayPixels(createImage(2, 2, "grayscale"));
		} catch (error) {
			expect((error as CoreError).code).toBe("unsupported");
		}
	});
});

describe("colorUsage", () => {
	test("counts and bounds a colour used in two places", () => {
		const image = createImage(6, 4, "rgba");
		setPixel(image, 1, 0, [10, 20, 30, 255]);
		setPixel(image, 4, 3, [10, 20, 30, 255]);
		setPixel(image, 2, 2, [10, 20, 30, 255]);
		expect(colorUsage(image)).toEqual([
			{
				color: rgba(10, 20, 30),
				pixels: 3,
				bounds: { x: 1, y: 0, width: 4, height: 4 },
			},
		]);
	});

	test("colours differing in alpha are distinct, alpha 0 is absent", () => {
		const image = createImage(3, 1, "rgba");
		setPixel(image, 0, 0, [10, 20, 30, 255]);
		setPixel(image, 1, 0, [10, 20, 30, 128]);
		setPixel(image, 2, 0, [99, 99, 99, 0]);
		expect(colorUsage(image)).toEqual([
			{
				color: rgba(10, 20, 30, 255),
				pixels: 1,
				bounds: { x: 0, y: 0, width: 1, height: 1 },
			},
			{
				color: rgba(10, 20, 30, 128),
				pixels: 1,
				bounds: { x: 1, y: 0, width: 1, height: 1 },
			},
		]);
	});

	test("rejects a grayscale image", () => {
		try {
			colorUsage(createImage(2, 2, "grayscale"));
			throw new Error("did not throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CoreError);
			expect((error as CoreError).code).toBe("unsupported");
		}
	});
});

describe("nearColorPairs", () => {
	test("channels 8 apart pair, 9 apart do not", () => {
		expect(nearColorPairs([rgba(0, 0, 0), rgba(8, 8, 8)])).toEqual([[0, 1]]);
		expect(nearColorPairs([rgba(0, 0, 0), rgba(9, 0, 0)])).toEqual([]);
	});

	test("an alpha difference alone counts", () => {
		expect(nearColorPairs([rgba(5, 5, 5, 255), rgba(5, 5, 5, 250)])).toEqual([
			[0, 1],
		]);
		expect(nearColorPairs([rgba(5, 5, 5, 255), rgba(5, 5, 5, 200)])).toEqual(
			[],
		);
	});

	test("three mutually near colours give every pair in order", () => {
		expect(
			nearColorPairs([rgba(0, 0, 0), rgba(1, 0, 0), rgba(2, 0, 0)]),
		).toEqual([
			[0, 1],
			[0, 2],
			[1, 2],
		]);
	});

	test("an empty or one-colour list gives no pairs", () => {
		expect(nearColorPairs([])).toEqual([]);
		expect(nearColorPairs([rgba(1, 2, 3)])).toEqual([]);
	});
});
