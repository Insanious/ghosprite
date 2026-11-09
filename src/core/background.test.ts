import { describe, expect, test } from "bun:test";
import {
	type Background,
	CHECKER_DARK,
	CHECKER_LIGHT,
	withBackground,
} from "./background.ts";
import { blendNormal } from "./blend.ts";
import { createImage, getPixel, type Rgba, setPixel } from "./image.ts";

const bg = (color: Rgba): Background => ({ kind: "color", color });
const white: Rgba = { r: 255, g: 255, b: 255, a: 255 };

function rgbaImage(width: number, height: number, pixels: Rgba[]) {
	const image = createImage(width, height, "rgba");
	pixels.forEach((p, i) => {
		setPixel(image, i % width, Math.floor(i / width), [p.r, p.g, p.b, p.a]);
	});
	return image;
}

describe("withBackground", () => {
	test("opaque pixels stay and transparent pixels become the background", () => {
		const red = { r: 255, g: 0, b: 0, a: 255 };
		const image = rgbaImage(2, 1, [red, { r: 9, g: 9, b: 9, a: 0 }]);
		const out = withBackground(image, bg({ r: 1, g: 2, b: 3, a: 255 }));
		expect(getPixel(out, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(getPixel(out, 1, 0)).toEqual([1, 2, 3, 255]);
	});

	test("a translucent pixel matches blendNormal", () => {
		const half = { r: 0, g: 0, b: 0, a: 128 };
		const out = withBackground(rgbaImage(1, 1, [half]), bg(white));
		const expected = blendNormal(white, half, 255);
		expect(getPixel(out, 0, 0)).toEqual([
			expected.r,
			expected.g,
			expected.b,
			expected.a,
		]);
	});

	test("a translucent background keeps its alpha under transparent pixels", () => {
		const out = withBackground(
			rgbaImage(1, 1, [{ r: 0, g: 0, b: 0, a: 0 }]),
			bg({ r: 10, g: 20, b: 30, a: 100 }),
		);
		expect(getPixel(out, 0, 0)).toEqual([10, 20, 30, 100]);
	});

	test("checker alternates by square size", () => {
		const empty = createImage(4, 2, "rgba");
		const colorAt = (square: number, x: number, y: number) =>
			getPixel(withBackground(empty, { kind: "checker", square }), x, y);
		const light = [CHECKER_LIGHT.r, CHECKER_LIGHT.g, CHECKER_LIGHT.b, 255];
		const dark = [CHECKER_DARK.r, CHECKER_DARK.g, CHECKER_DARK.b, 255];
		expect(colorAt(1, 0, 0)).toEqual(light);
		expect(colorAt(1, 1, 0)).toEqual(dark);
		expect(colorAt(1, 0, 1)).toEqual(dark);
		expect(colorAt(2, 0, 0)).toEqual(light);
		expect(colorAt(2, 1, 1)).toEqual(light);
		expect(colorAt(2, 2, 0)).toEqual(dark);
	});

	test("leaves the input image unchanged", () => {
		const image = rgbaImage(2, 1, [
			{ r: 1, g: 2, b: 3, a: 4 },
			{ r: 5, g: 6, b: 7, a: 0 },
		]);
		const before = image.data.slice();
		withBackground(image, bg(white));
		expect(image.data).toEqual(before);
	});
});
