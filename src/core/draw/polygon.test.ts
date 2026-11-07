import { describe, expect, test } from "bun:test";
import { createUnion, fillPolygon } from "./polygon.ts";

type Run = [x1: number, y: number, x2: number];

function runs(flat: number[]): Run[] {
	const points = [];
	for (let i = 0; i < flat.length; i += 2)
		points.push({ x: flat[i], y: flat[i + 1] });
	const out: Run[] = [];
	fillPolygon(points, (x1, y, x2) => out.push([x1, y, x2]));
	return out;
}

// Cases ported from Aseprite's polygon_tests.cpp (MIT).
const polygonCases: [string, number[], Run[]][] = [
	["single point", [2, 3], [[2, 3, 2]]],
	["two equal points", [2, 3, 2, 3], [[2, 3, 2]]],
	["three equal points", [2, 3, 2, 3, 2, 3], [[2, 3, 2]]],
	["horizontal line", [0, 0, 2, 0], [[0, 0, 2]]],
	["horizontal line with a middle point", [0, 0, 2, 0, 5, 0], [[0, 0, 5]]],
	[
		"vertical line",
		[0, 0, 0, 2],
		[
			[0, 0, 0],
			[0, 1, 0],
			[0, 2, 0],
		],
	],
	[
		"vertical line with a middle point",
		[0, 0, 0, 2, 0, 5],
		[
			[0, 0, 0],
			[0, 1, 0],
			[0, 2, 0],
			[0, 3, 0],
			[0, 4, 0],
			[0, 5, 0],
		],
	],
	[
		"triangle 1",
		[0, 0, 0, 2, 2, 0],
		[
			[0, 0, 2],
			[0, 1, 1],
			[0, 2, 0],
		],
	],
	[
		"triangle 2",
		[0, 4, 2, 0, 4, 4],
		[
			[2, 0, 2],
			[2, 1, 3],
			[1, 2, 3],
			[1, 3, 4],
			[0, 4, 4],
		],
	],
	[
		"triangle 3",
		[0, 4, 4, 4, 2, 0],
		[
			[2, 0, 2],
			[1, 1, 2],
			[1, 2, 3],
			[0, 3, 3],
			[0, 4, 4],
		],
	],
	[
		"triangle 4",
		[4, 4, 0, 4, 2, 0],
		[
			[2, 0, 2],
			[2, 1, 3],
			[1, 2, 3],
			[1, 3, 4],
			[0, 4, 4],
		],
	],
	[
		"square",
		[0, 0, 0, 2, 2, 2, 2, 0],
		[
			[0, 0, 2],
			[0, 1, 2],
			[0, 2, 2],
		],
	],
	[
		"concave polygon",
		[0, 0, 2, 3, 4, 0, 2, 1],
		[
			[0, 0, 1],
			[4, 0, 4],
			[1, 1, 3],
			[1, 2, 3],
			[2, 3, 2],
		],
	],
	[
		"ten-vertex polygon",
		[0, 1, 2, 4, 4, 3, 4, 0, 7, 0, 6, 3, 9, 7, 5, 5, 3, 7, 2, 5],
		[
			[4, 0, 7],
			[0, 1, 0],
			[4, 1, 7],
			[0, 2, 1],
			[4, 2, 6],
			[1, 3, 1],
			[3, 3, 6],
			[1, 4, 7],
			[2, 5, 8],
			[2, 6, 4],
			[7, 6, 8],
			[3, 7, 3],
			[9, 7, 9],
		],
	],
];

describe("fillPolygon", () => {
	test.each(polygonCases)("%s", (_name, flat, expected) => {
		expect(runs(flat)).toEqual(expected);
	});

	test("no points draws nothing", () => {
		expect(runs([])).toEqual([]);
	});
});

// [pairs, x, ints] -> [result, pairs, ints]; ints stays as given when the result is undefined.
const unionCases: [
	string,
	number[],
	number,
	number,
	number[],
	number | undefined,
][] = [
	["A1: empty, ints 0", [], 2, 0, [2, 2], 2],
	["A2: empty, ints 2", [], 5, 2, [], undefined],
	["A3: empty, ints 1", [], 5, 1, [], undefined],
	["A4: one element, ints 2", [0], 5, 2, [0], undefined],
	["B1: ints beyond size", [0, 0], 5, 3, [0, 0], undefined],
	["B2: ints 0 with leftovers", [0, 0], 5, 0, [5, 5, 0, 0], 2],
	["B3: ints 1", [0, 0], 5, 1, [0, 0], undefined],
	["B4: negative ints", [0, 0], 5, -1, [0, 0], undefined],
	["C1: x equals a start", [0, 1, 4, 5], 0, 4, [0, 1, 4, 5], 4],
	["C2: x equals an end", [0, 1, 4, 5], 1, 4, [0, 1, 4, 5], 4],
	["C3: x one before a start", [0, 1, 4, 5], -1, 4, [-1, 1, 4, 5], 4],
	["C4: x one after an end", [0, 1, 4, 5], 2, 4, [0, 2, 4, 5], 4],
	["C5: x well before", [0, 1, 4, 5], -2, 4, [-2, -2, 0, 1, 4, 5], 6],
	["C6: x well after", [0, 1, 4, 5], 7, 4, [0, 1, 4, 5, 7, 7], 6],
	["C7: x inside a segment", [0, 5], 3, 2, [0, 5], 2],
	["C8: x bridges two segments", [0, 2, 3, 4], 3, 4, [0, 4], 2],
	["C9: x bridges three segments", [0, 0, 1, 1, 2, 4], 1, 6, [0, 4], 2],
	["C10: stale entries after ints", [0, 3, 4, 7, 0, 0, 0, 0], 3, 4, [0, 7], 2],
];

describe("createUnion", () => {
	test.each(unionCases)(
		"%s",
		(_name, pairs, x, ints, expectedPairs, expectedInts) => {
			const arr = [...pairs];
			expect(createUnion(arr, x, ints)).toBe(expectedInts);
			const kept = expectedInts ?? ints;
			expect(arr.slice(0, kept)).toEqual(expectedPairs.slice(0, kept));
		},
	);
});
