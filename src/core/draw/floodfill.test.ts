import { describe, expect, test } from "bun:test";
import { createImage, type Image, type Rgba } from "../image.ts";
import { floodfill } from "./floodfill.ts";
import type { Mask } from "./spans.ts";

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

// '#' is black, '.' is white, any other character is its char code as grey.
function imageFrom(rows: string[]): Image {
	const image = createImage(rows[0]?.length ?? 0, rows.length, "rgba");
	rows.forEach((row, y) => {
		[...row].forEach((ch, x) => {
			const v = ch === "#" ? 0 : ch === "." ? 255 : ch.charCodeAt(0);
			image.data.set([v, v, v, 255], (y * image.width + x) * 4);
		});
	});
	return image;
}

type Options = {
	mask?: Mask;
	bounds?: { x: number; y: number; width: number; height: number };
	src?: Rgba;
	tolerance?: number;
	contiguous?: boolean;
	eight?: boolean;
};

function fill(image: Image, x: number, y: number, o: Options = {}): string[] {
	const grid = Array.from({ length: image.height }, (_, y) =>
		Array.from({ length: image.width }, (_, x) =>
			image.data[(y * image.width + x) * 4] === 0 ? "#" : ".",
		),
	);
	floodfill(
		image,
		o.mask,
		x,
		y,
		o.bounds ?? { x: 0, y: 0, width: image.width, height: image.height },
		o.src ?? WHITE,
		o.tolerance ?? 0,
		o.contiguous ?? true,
		o.eight ?? false,
		(x1, row, x2) => {
			for (let i = x1; i <= x2; i++) (grid[row] as string[])[i] = "o";
		},
	);
	return grid.map((r) => r.join(""));
}

describe("floodfill", () => {
	test("a contiguous fill stops at a closed outline", () => {
		const image = imageFrom(["......", ".####.", ".#..#.", ".####.", "......"]);
		expect(fill(image, 2, 2)).toEqual([
			"......",
			".####.",
			".#oo#.",
			".####.",
			"......",
		]);
	});

	test("a 4-connected fill does not cross a diagonal gap, an 8-connected fill does", () => {
		const image = imageFrom(["..#..", ".#...", "#...."]);
		expect(fill(image, 0, 0)).toEqual(["oo#..", "o#...", "#...."]);
		expect(fill(image, 0, 0, { eight: true })).toEqual([
			"oo#oo",
			"o#ooo",
			"#oooo",
		]);
	});

	test("a non-contiguous fill replaces every matching pixel", () => {
		const image = imageFrom(["..#..", "..#..", "..#.."]);
		expect(fill(image, 0, 0, { contiguous: false })).toEqual([
			"oo#oo",
			"oo#oo",
			"oo#oo",
		]);
	});

	test("tolerance 0 is exact and a tolerance equal to the channel difference includes the neighbour", () => {
		const image = createImage(2, 2, "rgba");
		for (const [i, v] of [255, 250, 255, 250].entries()) {
			image.data.set([v, v, v, 255], i * 4);
		}
		expect(fill(image, 0, 0)).toEqual(["o.", "o."]);
		expect(fill(image, 0, 0, { tolerance: 4 })).toEqual(["o.", "o."]);
		expect(fill(image, 0, 0, { tolerance: 5 })).toEqual(["oo", "oo"]);
	});

	test("two alpha-0 pixels with different RGB match at tolerance 0", () => {
		const image = createImage(2, 1, "rgba");
		image.data.set([10, 20, 30, 0, 200, 100, 50, 0]);
		expect(fill(image, 0, 0, { src: { r: 10, g: 20, b: 30, a: 0 } })).toEqual([
			"oo",
		]);
	});

	test("a start point outside the image does nothing", () => {
		const image = imageFrom(["..", ".."]);
		const untouched = ["..", ".."];
		expect(fill(image, -1, 0)).toEqual(untouched);
		expect(fill(image, 0, 2)).toEqual(untouched);
		expect(fill(image, 2, 0, { contiguous: false })).toEqual(untouched);
	});

	test("the bounds limit the fill", () => {
		const image = imageFrom(["....", "....", "...."]);
		expect(
			fill(image, 1, 1, { bounds: { x: 1, y: 1, width: 2, height: 2 } }),
		).toEqual(["....", ".oo.", ".oo."]);
	});

	test("a mask limits the fill to its bounds and to the region holding the start", () => {
		const image = imageFrom(["......", "......", "......"]);
		const mask: Mask = {
			bounds: { x: 0, y: 0, width: 5, height: 2 },
			bits: Uint8Array.from([1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
		};
		expect(fill(image, 0, 0, { mask })).toEqual(["oo....", "oo....", "......"]);
		expect(fill(image, 3, 0, { mask })).toEqual(["...oo.", "...oo.", "......"]);
		expect(fill(image, 5, 0, { mask })).toEqual(["......", "......", "......"]);
	});
});
