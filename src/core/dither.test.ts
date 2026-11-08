import { describe, expect, test } from "bun:test";
import { bayerMatrix, mapImageToPalette } from "./dither.ts";
import { createImage, type Rgba, rgbaHex } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";

const PALETTE: Rgba[] = [
	{ r: 0, g: 0, b: 0, a: 255 },
	{ r: 255, g: 255, b: 255, a: 255 },
	{ r: 255, g: 0, b: 0, a: 255 },
	{ r: 0, g: 0, b: 255, a: 255 },
];

describe("bayerMatrix", () => {
	test("makes Aseprite's 2x2 and 4x4 matrices", () => {
		expect(bayerMatrix(2).values).toEqual([0, 2, 3, 1]);
		expect(bayerMatrix(4).values).toEqual([
			0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
		]);
		expect(bayerMatrix(8).maxValue).toBe(63);
	});
});

describe("mapImageToPalette", () => {
	const image = createImage(8, 4, "rgba");
	for (let i = 0; i < 32; i++) {
		image.data.set(
			[i * 8, 255 - i * 8, (i * 37) % 256, i % 5 === 0 ? 0 : 255],
			i * 4,
		);
	}

	for (const dithering of ["none", "ordered", "old"] as const) {
		test(`${dithering}: every pixel is a palette colour or transparent`, () => {
			const map = new OctreeMap();
			map.regenerateMap(PALETTE, -1);
			const result = mapImageToPalette(image, {
				palette: PALETTE,
				map,
				maskIndex: -1,
				transparentIndex: 0,
				background: false,
				dithering,
				matrix: bayerMatrix(4),
			});
			const allowed = new Set([...PALETTE.map(rgbaHex), "#00000000"]);
			for (let i = 0; i < result.data.length; i += 4) {
				const [r, g, b, a] = result.data.subarray(i, i + 4);
				expect(allowed.has(rgbaHex({ r, g, b, a } as Rgba))).toBe(true);
			}
		});
	}
});
