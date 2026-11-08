import { describe, expect, test } from "bun:test";
import { createImage } from "../image.ts";
import { type Brush, createBrush, imageBrush } from "./brush.ts";

function rows(brush: Brush): string[] {
	const out: string[] = [];
	for (let y = 0; y < brush.height; y++) {
		let row = "";
		for (let x = 0; x < brush.width; x++)
			row += brush.mask[y * brush.width + x] ? "#" : ".";
		out.push(row);
	}
	return out;
}

// Expected shapes were printed by Aseprite's doc/brush.cpp (MIT).
const shapes: [string, Parameters<typeof createBrush>[0], number, string[]][] =
	[
		["circle size 1", { type: "circle", size: 1, angle: 0 }, 0, ["#"]],
		["circle size 2", { type: "circle", size: 2, angle: 0 }, 1, ["##", "##"]],
		[
			"circle size 4",
			{ type: "circle", size: 4, angle: 0 },
			2,
			[".##.", "####", "####", ".##."],
		],
		[
			"circle size 7",
			{ type: "circle", size: 7, angle: 0 },
			3,
			[
				"..###..",
				".#####.",
				"#######",
				"#######",
				"#######",
				".#####.",
				"..###..",
			],
		],
		["square size 1", { type: "square", size: 1, angle: 0 }, 0, ["#"]],
		[
			"square size 4 at angle 0",
			{ type: "square", size: 4, angle: 0 },
			2,
			["####", "####", "####", "####"],
		],
		[
			"square size 3 at 45 degrees is a cross",
			{ type: "square", size: 3, angle: 45 },
			1,
			[".#.", "###", ".#."],
		],
		[
			"square size 6 at 30 degrees on the enlarged canvas",
			{ type: "square", size: 6, angle: 30 },
			4,
			[
				".........",
				"....##...",
				"..#####..",
				".######..",
				".#######.",
				"..######.",
				"..#####..",
				"...##....",
				".........",
			],
		],
		[
			"square size 6 at 45 degrees on the enlarged canvas",
			{ type: "square", size: 6, angle: 45 },
			4,
			[
				"....#....",
				"...###...",
				"..#####..",
				".#######.",
				"#########",
				".#######.",
				"..#####..",
				"...###...",
				"....#....",
			],
		],
		[
			"line size 5 at 0 degrees",
			{ type: "line", size: 5, angle: 0 },
			2,
			[".....", ".....", "#####", ".....", "....."],
		],
		[
			"line size 5 at 45 degrees",
			{ type: "line", size: 5, angle: 45 },
			2,
			[".....", "...#.", "..#..", ".#...", "....."],
		],
		[
			"line size 5 at 90 degrees",
			{ type: "line", size: 5, angle: 90 },
			2,
			["..#..", "..#..", "..#..", "..#..", "..#.."],
		],
	];

describe("createBrush", () => {
	test.each(shapes)("%s", (_name, spec, centre, expected) => {
		const brush = createBrush(spec);
		expect(rows(brush)).toEqual(expected);
		expect(brush.center).toEqual({ x: centre, y: centre });
		expect(brush.image).toBeUndefined();
	});
});

describe("imageBrush", () => {
	test("centre is floor(w/2), floor(h/2)", () => {
		expect(imageBrush(createImage(3, 2, "rgba")).center).toEqual({
			x: 1,
			y: 1,
		});
		expect(imageBrush(createImage(4, 4, "rgba")).center).toEqual({
			x: 2,
			y: 2,
		});
	});

	test("a pixel is inside exactly when its alpha is non-zero", () => {
		const image = createImage(3, 1, "rgba");
		image.data.set([10, 20, 30, 0, 0, 0, 0, 1, 0, 0, 0, 255]);
		const brush = imageBrush(image);
		expect([...brush.mask]).toEqual([0, 1, 1]);
		expect(brush.image).toBe(image);
	});
});
