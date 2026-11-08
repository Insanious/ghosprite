import { describe, expect, test } from "bun:test";
import { maskFromRect } from "./draw/mask.ts";
import {
	combineMasks,
	maskFromEllipse,
	maskPixelCount,
	trimMask,
} from "./selection.ts";

const rect = (x: number, y: number, width: number, height: number) =>
	maskFromRect({ x, y, width, height });

describe("combineMasks", () => {
	test("add with disjoint bounds covers both", () => {
		const result = combineMasks(rect(0, 0, 2, 2), rect(5, 5, 2, 2), "add");
		expect(result.bounds).toEqual({ x: 0, y: 0, width: 7, height: 7 });
		expect(maskPixelCount(result)).toBe(8);
		expect(result.bits[0]).toBe(1);
		expect(result.bits[2]).toBe(0);
		expect(result.bits[6 * 7 + 6]).toBe(1);
	});

	test("subtracting a mask from itself is empty with zero-size bounds", () => {
		const result = combineMasks(rect(3, 4, 2, 2), rect(3, 4, 2, 2), "subtract");
		expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(maskPixelCount(result)).toBe(0);
	});

	test("intersecting non-overlapping masks is empty", () => {
		const result = combineMasks(
			rect(0, 0, 2, 2),
			rect(5, 5, 2, 2),
			"intersect",
		);
		expect(result.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	test("intersect trims to the overlap", () => {
		const result = combineMasks(
			rect(0, 0, 4, 4),
			rect(2, 2, 4, 4),
			"intersect",
		);
		expect(result.bounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });
	});

	test("either side may be empty", () => {
		const empty = trimMask(rect(0, 0, 0, 0));
		expect(combineMasks(empty, rect(1, 1, 2, 2), "add").bounds).toEqual({
			x: 1,
			y: 1,
			width: 2,
			height: 2,
		});
		expect(combineMasks(rect(1, 1, 2, 2), empty, "subtract").bounds).toEqual({
			x: 1,
			y: 1,
			width: 2,
			height: 2,
		});
		expect(maskPixelCount(combineMasks(empty, empty, "add"))).toBe(0);
	});
});

describe("trimMask", () => {
	test("drops empty edge rows and columns, with negative bounds", () => {
		const mask = {
			bounds: { x: -3, y: -2, width: 4, height: 3 },
			bits: Uint8Array.from([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]),
		};
		const trimmed = trimMask(mask);
		expect(trimmed.bounds).toEqual({ x: -2, y: -1, width: 2, height: 1 });
		expect([...trimmed.bits]).toEqual([1, 1]);
	});
});

describe("maskFromEllipse", () => {
	const rows = (size: { width: number; height: number }) => {
		const mask = maskFromEllipse({ x: 0, y: 0, ...size });
		return Array.from({ length: mask.bounds.height }, (_, row) =>
			Array.from(
				mask.bits.subarray(
					row * mask.bounds.width,
					(row + 1) * mask.bounds.width,
				),
			).join(""),
		);
	};

	test.each([
		[5, 5],
		[6, 6],
		[7, 4],
		[4, 7],
	])("%ix%i is symmetric", (width, height) => {
		const lines = rows({ width, height });
		expect(lines).toEqual([...lines].reverse());
		for (const line of lines) {
			expect(line).toBe([...line].reverse().join(""));
		}
	});

	test("1x1 gives one pixel", () => {
		const mask = maskFromEllipse({ x: 4, y: 5, width: 1, height: 1 });
		expect(mask.bounds).toEqual({ x: 4, y: 5, width: 1, height: 1 });
		expect(maskPixelCount(mask)).toBe(1);
	});
});
