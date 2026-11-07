import { describe, expect, test } from "bun:test";
import { clipSpan, type SpanClip } from "./spans.ts";

function collect(
	x1: number,
	y: number,
	x2: number,
	clip: SpanClip,
): number[][] {
	const spans: number[][] = [];
	clipSpan(x1, y, x2, clip, (a, b, c) => spans.push([a, b, c]));
	return spans;
}

const canvas = { width: 10, height: 5 };

describe("clipSpan", () => {
	test("clips at each canvas edge when not tiled", () => {
		expect(collect(-3, 1, 2, { canvas })).toEqual([[0, 1, 2]]);
		expect(collect(7, 1, 14, { canvas })).toEqual([[7, 1, 9]]);
		expect(collect(-5, 1, -1, { canvas })).toEqual([]);
		expect(collect(0, -1, 3, { canvas })).toEqual([]);
		expect(collect(0, 5, 3, { canvas })).toEqual([]);
	});

	test("splits a span that crosses an edge when tiled on x", () => {
		const clip: SpanClip = { canvas, tiled: "x" };
		expect(collect(-3, 1, 2, clip)).toEqual([
			[7, 1, 9],
			[0, 1, 2],
		]);
		expect(collect(7, 1, 12, clip)).toEqual([
			[7, 1, 9],
			[0, 1, 2],
		]);
		expect(collect(2, 1, 5, clip)).toEqual([[2, 1, 5]]);
	});

	test("a tiled span wider than the canvas covers the row once", () => {
		expect(collect(-4, 2, 20, { canvas, tiled: "x" })).toEqual([[0, 2, 9]]);
	});

	test("wraps a negative y when tiled on y", () => {
		expect(collect(2, -1, 4, { canvas, tiled: "y" })).toEqual([[2, 4, 4]]);
		expect(collect(2, 6, 4, { canvas, tiled: "y" })).toEqual([[2, 1, 4]]);
		expect(collect(-2, 0, 1, { canvas, tiled: "y" })).toEqual([[0, 0, 1]]);
	});

	test("a mask hole splits one span into two", () => {
		const mask = {
			bounds: { x: 0, y: 0, width: 10, height: 5 },
			bits: new Uint8Array(50).fill(1),
		};
		mask.bits[1 * 10 + 4] = 0;
		expect(collect(1, 1, 8, { canvas, mask })).toEqual([
			[1, 1, 3],
			[5, 1, 8],
		]);
	});

	test("a mask drops rows and columns outside its bounds", () => {
		const mask = {
			bounds: { x: 3, y: 1, width: 4, height: 2 },
			bits: new Uint8Array(8).fill(1),
		};
		expect(collect(0, 0, 9, { canvas, mask })).toEqual([]);
		expect(collect(0, 2, 9, { canvas, mask })).toEqual([[3, 2, 6]]);
	});

	test("wrapping can land a span inside a mask it started outside", () => {
		const mask = {
			bounds: { x: 0, y: 0, width: 3, height: 5 },
			bits: new Uint8Array(15).fill(1),
		};
		expect(collect(10, 0, 11, { canvas, tiled: "x", mask })).toEqual([
			[0, 0, 1],
		]);
		expect(collect(10, 0, 11, { canvas, mask })).toEqual([]);
	});
});
