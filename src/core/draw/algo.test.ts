import { describe, expect, test } from "bun:test";
import {
	algoEllipse,
	algoEllipsefill,
	algoLineContinuous,
	algoLineContinuousWithFixForLineBrush,
	algoSpline,
} from "./algo";

// Expected values were printed by Aseprite's src/doc/algo.cpp.
type Pixels = [number, number][];

function collect(run: (proc: (x: number, y: number) => void) => void): Pixels {
	const out: Pixels = [];
	run((x, y) => out.push([x, y]));
	return out;
}

const lineCases: {
	name: string;
	from: [number, number];
	to: [number, number];
	plain: Pixels;
	fixed: Pixels;
}[] = [
	{
		name: "shallow",
		from: [0, 0],
		to: [5, 2],
		plain: [
			[0, 0],
			[1, 0],
			[2, 1],
			[3, 1],
			[4, 2],
			[5, 2],
		],
		fixed: [
			[0, 0],
			[1, 0],
			[2, 0],
			[2, 1],
			[3, 1],
			[4, 1],
			[4, 2],
			[5, 2],
		],
	},
	{
		name: "shallow reversed",
		from: [5, 2],
		to: [0, 0],
		plain: [
			[5, 2],
			[4, 2],
			[3, 1],
			[2, 1],
			[1, 0],
			[0, 0],
		],
		fixed: [
			[5, 2],
			[4, 2],
			[3, 2],
			[3, 1],
			[2, 1],
			[1, 1],
			[1, 0],
			[0, 0],
		],
	},
	{
		name: "steep",
		from: [0, 0],
		to: [2, 5],
		plain: [
			[0, 0],
			[0, 1],
			[1, 2],
			[1, 3],
			[2, 4],
			[2, 5],
		],
		fixed: [
			[0, 0],
			[0, 1],
			[1, 1],
			[1, 2],
			[1, 3],
			[2, 3],
			[2, 4],
			[2, 5],
		],
	},
	{
		name: "steep reversed",
		from: [2, 5],
		to: [0, 0],
		plain: [
			[2, 5],
			[2, 4],
			[1, 3],
			[1, 2],
			[0, 1],
			[0, 0],
		],
		fixed: [
			[2, 5],
			[2, 4],
			[1, 4],
			[1, 3],
			[1, 2],
			[0, 2],
			[0, 1],
			[0, 0],
		],
	},
	{
		name: "45 degrees",
		from: [0, 0],
		to: [4, 4],
		plain: [
			[0, 0],
			[1, 1],
			[2, 2],
			[3, 3],
			[4, 4],
		],
		fixed: [
			[0, 0],
			[1, 0],
			[1, 1],
			[2, 1],
			[2, 2],
			[3, 2],
			[3, 3],
			[4, 3],
			[4, 4],
		],
	},
	{
		name: "45 degrees reversed",
		from: [4, 4],
		to: [0, 0],
		plain: [
			[4, 4],
			[3, 3],
			[2, 2],
			[1, 1],
			[0, 0],
		],
		fixed: [
			[4, 4],
			[3, 4],
			[3, 3],
			[2, 3],
			[2, 2],
			[1, 2],
			[1, 1],
			[0, 1],
			[0, 0],
		],
	},
	{
		name: "(0,0) to (2,1)",
		from: [0, 0],
		to: [2, 1],
		plain: [
			[0, 0],
			[1, 1],
			[2, 1],
		],
		fixed: [
			[0, 0],
			[1, 0],
			[1, 1],
			[2, 1],
		],
	},
	{
		name: "(2,1) to (0,0)",
		from: [2, 1],
		to: [0, 0],
		plain: [
			[2, 1],
			[1, 0],
			[0, 0],
		],
		fixed: [
			[2, 1],
			[1, 1],
			[1, 0],
			[0, 0],
		],
	},
	{
		name: "single point",
		from: [3, 3],
		to: [3, 3],
		plain: [[3, 3]],
		fixed: [[3, 3]],
	},
	{
		name: "horizontal",
		from: [0, 0],
		to: [6, 0],
		plain: [
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0],
			[4, 0],
			[5, 0],
			[6, 0],
		],
		fixed: [
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0],
			[4, 0],
			[5, 0],
			[6, 0],
		],
	},
	{
		name: "vertical upwards",
		from: [1, 6],
		to: [1, 2],
		plain: [
			[1, 6],
			[1, 5],
			[1, 4],
			[1, 3],
			[1, 2],
		],
		fixed: [
			[1, 6],
			[1, 5],
			[1, 4],
			[1, 3],
			[1, 2],
		],
	},
];

describe("algoLineContinuous", () => {
	for (const c of lineCases) {
		test(c.name, () => {
			expect(collect((p) => algoLineContinuous(...c.from, ...c.to, p))).toEqual(
				c.plain,
			);
		});
	}
});

describe("algoLineContinuousWithFixForLineBrush", () => {
	for (const c of lineCases) {
		test(c.name, () => {
			expect(
				collect((p) =>
					algoLineContinuousWithFixForLineBrush(...c.from, ...c.to, p),
				),
			).toEqual(c.fixed);
		});
	}
});

const ellipseCases: {
	name: string;
	box: [number, number, number, number];
	extra?: [number, number];
	outline: Pixels;
	fill: [number, number, number][];
}[] = [
	{
		name: "1x1",
		box: [0, 0, 0, 0],
		outline: [
			[0, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		],
		fill: [
			[0, 0, 0],
			[0, 0, 0],
		],
	},
	{
		name: "2x2",
		box: [0, 0, 1, 1],
		outline: [
			[1, 1],
			[0, 1],
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
			[0, 0],
			[1, 0],
		],
		fill: [
			[0, 1, 1],
			[0, 0, 1],
			[0, 1, 0],
			[1, 1, 1],
			[0, 0, 0],
			[1, 0, 1],
		],
	},
	{
		name: "5x3",
		box: [0, 0, 4, 2],
		outline: [
			[4, 1],
			[0, 1],
			[0, 1],
			[4, 1],
			[3, 2],
			[1, 2],
			[1, 0],
			[3, 0],
			[2, 2],
			[2, 2],
			[2, 0],
			[2, 0],
			[2, 2],
			[2, 2],
			[2, 0],
			[2, 0],
		],
		fill: [
			[0, 1, 4],
			[0, 1, 4],
			[1, 2, 3],
			[1, 0, 3],
			[2, 2, 2],
			[2, 0, 2],
			[2, 2, 2],
			[2, 2, 2],
			[2, 0, 2],
			[2, 0, 2],
		],
	},
	{
		name: "swapped corners 5x3",
		box: [4, 2, 0, 0],
		outline: [
			[4, 1],
			[0, 1],
			[0, 1],
			[4, 1],
			[3, 2],
			[1, 2],
			[1, 0],
			[3, 0],
			[2, 2],
			[2, 2],
			[2, 0],
			[2, 0],
			[2, 2],
			[2, 2],
			[2, 0],
			[2, 0],
		],
		fill: [
			[0, 1, 4],
			[0, 1, 4],
			[1, 2, 3],
			[1, 0, 3],
			[2, 2, 2],
			[2, 0, 2],
			[2, 2, 2],
			[2, 2, 2],
			[2, 0, 2],
			[2, 0, 2],
		],
	},
	{
		name: "6x6",
		box: [0, 0, 5, 5],
		outline: [
			[5, 2],
			[0, 2],
			[0, 3],
			[5, 3],
			[5, 3],
			[0, 3],
			[0, 2],
			[5, 2],
			[4, 4],
			[1, 4],
			[1, 1],
			[4, 1],
			[3, 5],
			[2, 5],
			[2, 0],
			[3, 0],
			[2, 5],
			[3, 5],
			[3, 0],
			[2, 0],
			[3, 5],
			[2, 5],
			[3, 0],
			[2, 0],
		],
		fill: [
			[0, 2, 5],
			[0, 3, 5],
			[0, 3, 5],
			[0, 2, 5],
			[1, 4, 4],
			[1, 1, 4],
			[2, 5, 3],
			[2, 0, 3],
			[3, 5, 2],
			[3, 0, 2],
			[3, 5, 3],
			[2, 5, 2],
			[3, 0, 3],
			[2, 0, 2],
		],
	},
	{
		name: "8x8 (manual adjustment)",
		box: [0, 0, 7, 7],
		outline: [
			[7, 4],
			[0, 4],
			[0, 3],
			[7, 3],
			[7, 5],
			[0, 5],
			[0, 2],
			[7, 2],
			[6, 6],
			[1, 6],
			[1, 1],
			[6, 1],
			[5, 7],
			[2, 7],
			[2, 0],
			[5, 0],
			[4, 7],
			[3, 7],
			[3, 0],
			[4, 0],
			[3, 7],
			[4, 7],
			[3, 0],
			[4, 0],
		],
		fill: [
			[0, 4, 7],
			[0, 3, 7],
			[0, 5, 7],
			[0, 2, 7],
			[1, 6, 6],
			[1, 1, 6],
			[2, 7, 5],
			[2, 0, 5],
			[3, 7, 4],
			[3, 0, 4],
			[3, 7, 3],
			[4, 7, 4],
			[3, 0, 3],
			[4, 0, 4],
		],
	},
	{
		name: "12x7",
		box: [0, 0, 11, 6],
		outline: [
			[11, 3],
			[0, 3],
			[0, 3],
			[11, 3],
			[11, 4],
			[0, 4],
			[0, 2],
			[11, 2],
			[10, 5],
			[1, 5],
			[1, 1],
			[10, 1],
			[9, 5],
			[2, 5],
			[2, 1],
			[9, 1],
			[8, 6],
			[3, 6],
			[3, 0],
			[8, 0],
			[7, 6],
			[4, 6],
			[4, 0],
			[7, 0],
			[6, 6],
			[5, 6],
			[5, 0],
			[6, 0],
			[5, 6],
			[6, 6],
			[5, 0],
			[6, 0],
		],
		fill: [
			[0, 3, 11],
			[0, 3, 11],
			[0, 4, 11],
			[0, 2, 11],
			[1, 5, 10],
			[1, 1, 10],
			[2, 5, 9],
			[2, 1, 9],
			[3, 6, 8],
			[3, 0, 8],
			[4, 6, 7],
			[4, 0, 7],
			[5, 6, 6],
			[5, 0, 6],
			[5, 6, 5],
			[6, 6, 6],
			[5, 0, 5],
			[6, 0, 6],
		],
	},
	{
		name: "9x8 with straight pixels",
		box: [0, 0, 8, 7],
		extra: [2, 1],
		outline: [
			[8, 5],
			[0, 5],
			[0, 2],
			[8, 2],
			[7, 6],
			[1, 6],
			[1, 1],
			[7, 1],
			[6, 7],
			[2, 7],
			[2, 0],
			[6, 0],
			[5, 7],
			[3, 7],
			[3, 0],
			[5, 0],
			[3, 7],
			[5, 7],
			[3, 0],
			[5, 0],
			[4, 0],
			[4, 7],
			[0, 3],
			[8, 3],
			[0, 4],
			[8, 4],
		],
		fill: [
			[0, 5, 8],
			[0, 2, 8],
			[1, 6, 7],
			[1, 1, 7],
			[2, 7, 6],
			[2, 0, 6],
			[3, 7, 5],
			[3, 0, 5],
			[3, 7, 3],
			[5, 7, 5],
			[3, 0, 3],
			[5, 0, 5],
			[0, 3, 8],
			[0, 4, 8],
		],
	},
];

describe("algoEllipse", () => {
	for (const c of ellipseCases) {
		test(c.name, () => {
			const [h, v] = c.extra ?? [0, 0];
			expect(collect((p) => algoEllipse(...c.box, h, v, p))).toEqual(c.outline);
		});
	}
});

describe("algoEllipsefill", () => {
	for (const c of ellipseCases) {
		test(c.name, () => {
			const [h, v] = c.extra ?? [0, 0];
			const spans: [number, number, number][] = [];
			algoEllipsefill(...c.box, h, v, (x1, y, x2) => spans.push([x1, y, x2]));
			expect(spans).toEqual(c.fill);
		});
	}

	test("spans cover every row of the outline", () => {
		for (const c of ellipseCases) {
			const [h, v] = c.extra ?? [0, 0];
			const rows = new Set<number>();
			algoEllipsefill(...c.box, h, v, (_x1, y) => rows.add(y));
			const outlineRows = new Set(c.outline.map(([, y]) => y));
			expect(rows).toEqual(outlineRows);
		}
	});
});

describe("algoSpline", () => {
	type Segments = [number, number, number, number][];
	function segments(...pts: number[]): Segments {
		const out: Segments = [];
		const [a, b, c, d, e, f, g, h] = pts;
		algoSpline(a, b, c, d, e, f, g, h, (x1, y1, x2, y2) =>
			out.push([x1, y1, x2, y2]),
		);
		return out;
	}

	test("straight control points give the straight segments", () => {
		expect(segments(0, 0, 3, 3, 6, 6, 9, 9)).toEqual([
			[0, 0, 3, 3],
			[3, 3, 6, 6],
			[6, 6, 9, 9],
		]);
	});

	test("S curve starts and ends on the end points", () => {
		expect(segments(0, 0, 10, 0, 10, 10, 20, 10)).toEqual([
			[0, 0, 5, 1],
			[5, 1, 8, 4],
			[8, 4, 12, 6],
			[12, 6, 15, 9],
			[15, 9, 20, 10],
		]);
	});

	test("coincident points give the minimum four points", () => {
		expect(segments(2, 3, 2, 3, 2, 3, 2, 3)).toEqual([
			[2, 3, 2, 3],
			[2, 3, 2, 3],
			[2, 3, 2, 3],
		]);
	});

	test("fractional control points truncate", () => {
		expect(segments(0.5, 0.5, 8.5, 1.5, 3.2, 9.7, 12.9, 11.1)).toEqual([
			[0, 0, 4, 2],
			[4, 2, 6, 4],
			[6, 4, 7, 7],
			[7, 7, 9, 10],
			[9, 10, 13, 11],
		]);
	});
});
