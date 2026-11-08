import { expect, test } from "bun:test";
import { createImage, type Rgba } from "../image.ts";
import { createBrush, imageBrush } from "./brush.ts";
import { drawShape, type Shape, type StrokeOptions } from "./stroke.ts";

const red: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const dot = createBrush({ type: "square", size: 1, angle: 0 });

function draw(
	size: number,
	shape: Shape,
	options: Partial<StrokeOptions> = {},
) {
	const image = createImage(size, size, "rgba");
	drawShape({ image, x: 0, y: 0 }, { width: size, height: size }, shape, {
		color: red,
		ink: "simple",
		opacity: 255,
		brush: dot,
		...options,
	});
	return image;
}

function grid(image: ReturnType<typeof draw>): string[] {
	const rows: string[] = [];
	for (let y = 0; y < image.height; y++) {
		let row = "";
		for (let x = 0; x < image.width; x++)
			row += image.data[(y * image.width + x) * 4 + 3] ? "#" : ".";
		rows.push(row);
	}
	return rows;
}

function count(image: ReturnType<typeof draw>): number {
	return grid(image).join("").replaceAll(".", "").length;
}

const pts = (...xy: number[][]) => xy.map(([x, y]) => ({ x, y }));

test("a size-1 line and polyline", () => {
	const line = draw(4, {
		kind: "line",
		points: pts([0, 0], [3, 3]),
		pixelPerfect: false,
	});
	expect(grid(line)).toEqual(["#...", ".#..", "..#.", "...#"]);
	const poly = draw(4, {
		kind: "line",
		points: pts([0, 0], [3, 0], [3, 2]),
		pixelPerfect: false,
	});
	expect(grid(poly)).toEqual(["####", "...#", "...#", "...."]);
});

test("a pixel-perfect line drops L-corners judged against the thinned list", () => {
	const image = draw(3, {
		kind: "line",
		points: pts([0, 0], [1, 0], [1, 1], [2, 1]),
		pixelPerfect: true,
	});
	expect(grid(image)).toEqual(["#..", ".##", "..."]);
});

test("a pixel-perfect line keeps (0,0) and its end", () => {
	const image = draw(3, {
		kind: "line",
		points: pts([0, 0], [1, 0], [1, 1]),
		pixelPerfect: true,
	});
	expect(grid(image)).toEqual(["#..", ".#.", "..."]);
});

test("a segment going right and down uses the line-brush fix, right and up does not", () => {
	const brush = createBrush({ type: "line", size: 5, angle: 45 });
	const down = draw(
		12,
		{ kind: "line", points: pts([2, 2], [8, 8]), pixelPerfect: false },
		{ brush },
	);
	const up = draw(
		12,
		{ kind: "line", points: pts([2, 8], [8, 2]), pixelPerfect: false },
		{ brush },
	);
	expect(count(down)).not.toBe(count(up));
	expect(grid(down)).toEqual([
		"............",
		"...##.......",
		"..####......",
		".######.....",
		"..######....",
		"...######...",
		"....######..",
		".....#####..",
		"......###...",
		".......#....",
		"............",
		"............",
	]);
	expect(grid(up)).toEqual([
		"............",
		".........#..",
		"........#...",
		".......#....",
		"......#.....",
		".....#......",
		"....#.......",
		"...#........",
		"..#.........",
		".#..........",
		"............",
		"............",
	]);
});

test("filled rect pixel count and a size-3 square brush growth", () => {
	const rect = { x: 3, y: 3, width: 4, height: 3 };
	expect(count(draw(10, { kind: "rect", rect, filled: true }))).toBe(12);
	const brush = createBrush({ type: "square", size: 3, angle: 0 });
	const grown = draw(10, { kind: "rect", rect, filled: true }, { brush });
	expect(count(grown)).toBe(6 * 5);
	expect(grid(grown)[2]).toBe("..######..");
	expect(grid(grown)[1]).toBe("..........");
});

test("a rect outline is hollow", () => {
	const image = draw(5, {
		kind: "rect",
		rect: { x: 0, y: 0, width: 5, height: 4 },
		filled: false,
	});
	expect(grid(image)).toEqual(["#####", "#...#", "#...#", "#####", "....."]);
});

test("a filled ellipse and an outline ellipse draw", () => {
	const rect = { x: 0, y: 0, width: 5, height: 5 };
	const filled = draw(5, { kind: "ellipse", rect, filled: true });
	const outline = draw(5, { kind: "ellipse", rect, filled: false });
	expect(count(filled)).toBeGreaterThan(count(outline));
	expect(grid(outline)[2]).toBe("#...#");
});

test("a bezier joins its end points and a polygon fills", () => {
	const bezier = draw(10, {
		kind: "bezier",
		points: pts([0, 9], [0, 0], [9, 0], [9, 9]),
	});
	expect(grid(bezier)[9][0]).toBe("#");
	expect(grid(bezier)[9][9]).toBe("#");
	const polygon = draw(6, {
		kind: "polygon",
		points: pts([1, 1], [4, 1], [4, 4], [1, 4]),
	});
	expect(count(polygon)).toBe(16);
});

test("a self-crossing polyline with a semi-transparent colour has uniform alpha", () => {
	const half = { r: 255, g: 0, b: 0, a: 128 };
	const image = draw(
		5,
		{
			kind: "line",
			points: pts([0, 2], [4, 2], [2, 0], [2, 4]),
			pixelPerfect: false,
		},
		{ color: half, ink: "alphaCompositing" },
	);
	const alphas = new Set<number>();
	for (let i = 3; i < image.data.length; i += 4)
		if (image.data[i]) alphas.add(image.data[i]);
	expect(alphas.size).toBe(1);
});

test("an image brush paints its own colours", () => {
	const stamp = createImage(2, 1, "rgba");
	stamp.data.set([0, 255, 0, 255, 0, 0, 255, 255]);
	const image = draw(
		4,
		{ kind: "line", points: pts([2, 2]), pixelPerfect: false },
		{ brush: imageBrush(stamp) },
	);
	const at = (x: number, y: number) => [
		...image.data.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4),
	];
	expect(at(1, 2)).toEqual([0, 255, 0, 255]);
	expect(at(2, 2)).toEqual([0, 0, 255, 255]);
});

test("overlapping stamps of a semi-transparent image brush compound", () => {
	const stamp = createImage(2, 1, "rgba");
	stamp.data.set([255, 0, 0, 128, 255, 0, 0, 128]);
	const image = draw(
		4,
		{ kind: "line", points: pts([1, 1], [2, 1]), pixelPerfect: false },
		{ brush: imageBrush(stamp) },
	);
	const alphaAt = (x: number) => image.data[(4 + x) * 4 + 3];
	expect([alphaAt(0), alphaAt(1), alphaAt(2)]).toEqual([128, 192, 128]);
});

test("a brush stamp wraps in tiled mode", () => {
	const brush = createBrush({ type: "square", size: 3, angle: 0 });
	const image = draw(
		4,
		{ kind: "line", points: pts([0, 0]), pixelPerfect: false },
		{ brush, tiled: "both" },
	);
	expect(grid(image)).toEqual(["##.#", "##.#", "....", "##.#"]);
});

test("a mask clips a filled rect", () => {
	const mask = {
		bounds: { x: 1, y: 1, width: 2, height: 2 },
		bits: new Uint8Array([1, 0, 1, 1]),
	};
	const image = draw(
		4,
		{ kind: "rect", rect: { x: 0, y: 0, width: 4, height: 4 }, filled: true },
		{ mask },
	);
	expect(grid(image)).toEqual(["....", ".#..", ".##.", "...."]);
});
