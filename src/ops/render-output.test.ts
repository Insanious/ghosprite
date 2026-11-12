import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { createImage, decodePng } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { renderPng } from "./render-output.ts";

const single = { columns: 1, gap: 0 };

function decoded(png: Uint8Array) {
	const { data, width } = decodePng(png, inflateSync);
	const at = (x: number, y: number) => [
		...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
	];
	return { at, width };
}

function thrown(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("Expected an OpError");
}

describe("renderPng pixel limit", () => {
	const square = [createImage(64, 64, "rgba")];

	test("exactly the limit passes, and the grid line pushes it over", () => {
		expect(() =>
			renderPng(square, { scale: 64, grid: false }, single, "scale"),
		).not.toThrow();
		const error = thrown(() =>
			renderPng(square, { scale: 64, grid: true }, single, "render.scale"),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.scale",
			message: "A 4097x4097 render is over the 16777216 pixel limit",
		});
	});

	test("the gaps count toward the limit", () => {
		const cells = [createImage(32, 64, "rgba"), createImage(32, 64, "rgba")];
		expect(() =>
			renderPng(
				cells,
				{ scale: 64, grid: false },
				{ columns: 2, gap: 0 },
				"scale",
			),
		).not.toThrow();
		const error = thrown(() =>
			renderPng(
				cells,
				{ scale: 64, grid: false },
				{ columns: 2, gap: 1 },
				"scale",
			),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "scale",
		});
	});
});

describe("renderPng background", () => {
	const blank = (width = 40, height = 4) => [
		createImage(width, height, "rgba"),
	];

	test("a colour background fills each cell and the gaps stay transparent", () => {
		const { at, width } = decoded(
			renderPng(
				[...blank(2, 1), ...blank(2, 1)],
				{ scale: 1, grid: false, background: "#203040" },
				{ columns: 2, gap: 1 },
				"scale",
			).png,
		);
		expect(width).toBe(5);
		expect(at(0, 0)).toEqual([0x20, 0x30, 0x40, 255]);
		expect(at(2, 0)).toEqual([0, 0, 0, 0]);
		expect(at(3, 0)).toEqual([0x20, 0x30, 0x40, 255]);
	});

	test("without a background a transparent pixel stays transparent", () => {
		const { at } = decoded(
			renderPng(blank(), { scale: 1, grid: false }, single, "scale").png,
		);
		expect(at(0, 0)).toEqual([0, 0, 0, 0]);
	});

	test("checker squares are 8 output pixels at scale 1 and 4, and 9 at scale 3", () => {
		const light = [0xcc, 0xcc, 0xcc, 255];
		const dark = [0x99, 0x99, 0x99, 255];
		const at = (scale: number) =>
			decoded(
				renderPng(
					blank(),
					{ scale, grid: false, background: "checker" },
					single,
					"scale",
				).png,
			).at;
		expect([at(1)(7, 0), at(1)(8, 0)]).toEqual([light, dark]);
		expect([at(4)(7, 0), at(4)(8, 0)]).toEqual([light, dark]);
		expect([at(3)(8, 0), at(3)(9, 0)]).toEqual([light, dark]);
	});

	test("the grid is drawn over the background", () => {
		const { at } = decoded(
			renderPng(
				blank(),
				{ scale: 4, grid: true, background: "#203040" },
				single,
				"scale",
			).png,
		);
		expect(at(0, 0)).not.toEqual([0x20, 0x30, 0x40, 255]);
		expect(at(1, 1)).toEqual([0x20, 0x30, 0x40, 255]);
	});

	test("a highlight shows over the background", () => {
		const highlight = {
			bounds: { x: 1, y: 0, width: 1, height: 1 },
			bits: new Uint8Array([1]),
		};
		const { at } = decoded(
			renderPng(
				blank(2, 1),
				{ scale: 1, grid: false, background: "#ffffff" },
				single,
				"scale",
				highlight,
			).png,
		);
		expect(at(1, 0)).toEqual([255, 127, 255, 255]);
		expect(at(0, 0)).toEqual([255, 255, 255, 255]);
	});
});

describe("renderPng rects", () => {
	test("match where each image lands", () => {
		const { rects } = renderPng(
			[
				createImage(2, 2, "rgba"),
				createImage(2, 2, "rgba"),
				createImage(2, 2, "rgba"),
			],
			{ scale: 4, grid: true },
			{ columns: 2, gap: 3 },
			"scale",
		);
		expect(rects).toEqual([
			{ x: 0, y: 0, width: 9, height: 9 },
			{ x: 12, y: 0, width: 9, height: 9 },
			{ x: 0, y: 12, width: 9, height: 9 },
		]);
	});
});
