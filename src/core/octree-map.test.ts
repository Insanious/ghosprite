import { describe, expect, test } from "bun:test";
import type { Rgba } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";

const rgba = (r: number, g: number, b: number, a = 255): Rgba => ({
	r,
	g,
	b,
	a,
});

describe("OctreeMap mapColor", () => {
	const palette = [
		rgba(0, 0, 0, 0),
		rgba(255, 0, 0),
		rgba(0, 255, 0),
		rgba(0, 0, 255),
		rgba(255, 255, 255),
	];

	test("returns the index of an exact match", () => {
		const octree = new OctreeMap();
		octree.regenerateMap(palette, -1);
		palette.forEach((c, i) => {
			expect(octree.mapColor(c.r, c.g, c.b, c.a)).toBe(i);
		});
	});

	test("an opaque colour never maps to the mask index", () => {
		const octree = new OctreeMap();
		octree.regenerateMap(palette, 0);
		for (const [r, g, b] of [
			[1, 1, 1],
			[250, 10, 10],
			[0, 0, 0],
		] as const) {
			expect(octree.mapColor(r, g, b, 255)).not.toBe(0);
		}
		expect(octree.mapColor(9, 9, 9, 0)).toBe(0);
	});

	test("a colour with no exact match takes a palette index", () => {
		const octree = new OctreeMap();
		octree.regenerateMap(palette, 0);
		expect(octree.mapColor(240, 20, 10, 255)).toBe(1);
	});
});

describe("OctreeMap makePalette", () => {
	test("reports when a deeper octree would help", () => {
		const octree = new OctreeMap();
		octree.addColor(rgba(1, 2, 3));
		expect(octree.makePalette(8)).toBeUndefined();
	});
});
