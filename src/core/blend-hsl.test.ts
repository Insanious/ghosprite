import { describe, expect, test } from "bun:test";
import {
	blendHslColor,
	blendHslHue,
	blendHslLuminosity,
	blendHslSaturation,
	clipColor,
	lum,
	type Rgb,
} from "./blend-hsl.ts";

describe("HSL blenders", () => {
	test("a grey source under saturation gives a grey result", () => {
		const out = blendHslSaturation(
			{ r: 200, g: 100, b: 50, a: 255 },
			{ r: 90, g: 90, b: 90, a: 255 },
			255,
		);
		expect(out.r).toBe(out.g);
		expect(out.g).toBe(out.b);
	});

	test("clipColor pulls channels back into 0 to 1 in both directions", () => {
		const low: Rgb = [-0.2, 0.3, 0.6];
		clipColor(low);
		expect(Math.min(...low)).toBeGreaterThanOrEqual(-1e-12);

		const high: Rgb = [0.2, 0.7, 1.4];
		clipColor(high);
		expect(Math.max(...high)).toBeLessThanOrEqual(1 + 1e-12);
	});

	test("hue on a red backdrop with a blue source keeps the backdrop's luminosity", () => {
		const out = blendHslHue(
			{ r: 255, g: 0, b: 0, a: 255 },
			{ r: 0, g: 0, b: 255, a: 255 },
			255,
		);
		const before = lum(1, 0, 0);
		const after = lum(out.r / 255, out.g / 255, out.b / 255);
		expect(Math.abs(after - before)).toBeLessThan(0.01);
	});

	test("source alpha 0 returns the backdrop unchanged", () => {
		const backdrop = { r: 10, g: 120, b: 200, a: 255 };
		const src = { r: 250, g: 30, b: 60, a: 0 };
		for (const blend of [
			blendHslHue,
			blendHslSaturation,
			blendHslColor,
			blendHslLuminosity,
		]) {
			expect(blend(backdrop, src, 255)).toEqual(backdrop);
		}
	});
});
