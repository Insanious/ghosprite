import { describe, expect, test } from "bun:test";
import { blendNormal, div8, mul8 } from "./blend.ts";

describe("mul8 and div8", () => {
	test("mul8 rounds a*b/255", () => {
		expect(mul8(0, 255)).toBe(0);
		expect(mul8(255, 255)).toBe(255);
		expect(mul8(128, 128)).toBe(64);
		expect(mul8(128, 255)).toBe(128);
		expect(mul8(1, 128)).toBe(1);
	});

	test("div8 rounds a*255/b", () => {
		expect(div8(0, 128)).toBe(0);
		expect(div8(255, 255)).toBe(255);
		expect(div8(128, 255)).toBe(128);
		expect(div8(64, 128)).toBe(128);
		expect(div8(128, 128)).toBe(255);
	});
});

describe("blendNormal", () => {
	test("transparent backdrop returns the source colour with scaled alpha", () => {
		const out = blendNormal(
			{ r: 9, g: 9, b: 9, a: 0 },
			{ r: 10, g: 20, b: 30, a: 200 },
			128,
		);
		expect(out).toEqual({ r: 10, g: 20, b: 30, a: mul8(200, 128) });
	});

	test("transparent source leaves the backdrop unchanged", () => {
		const backdrop = { r: 1, g: 2, b: 3, a: 100 };
		expect(blendNormal(backdrop, { r: 255, g: 0, b: 0, a: 0 }, 255)).toEqual(
			backdrop,
		);
	});

	test("a source channel below the backdrop's truncates toward zero", () => {
		// Sa = 128, Ra = 255: (100 - 200) * 128 / 255 = -50.2, so trunc gives -50 where floor gives -51.
		const out = blendNormal(
			{ r: 200, g: 0, b: 0, a: 255 },
			{ r: 100, g: 0, b: 0, a: 128 },
			255,
		);
		expect(out.a).toBe(255);
		expect(out.r).toBe(150);
	});

	test("a step between -1 and 0 truncates to 0", () => {
		// (10 - 11) * 128 / 255 = -0.5: trunc gives 0 where floor gives -1.
		const out = blendNormal(
			{ r: 11, g: 0, b: 0, a: 255 },
			{ r: 10, g: 0, b: 0, a: 128 },
			255,
		);
		expect(out.r).toBe(11);
	});

	test("opacity 0 leaves a visible backdrop unchanged", () => {
		const backdrop = { r: 40, g: 50, b: 60, a: 90 };
		expect(
			blendNormal(backdrop, { r: 255, g: 255, b: 255, a: 255 }, 0),
		).toEqual(backdrop);
	});

	test("opacity 0 over a transparent backdrop keeps source rgb with alpha 0", () => {
		expect(
			blendNormal(
				{ r: 0, g: 0, b: 0, a: 0 },
				{ r: 10, g: 20, b: 30, a: 255 },
				0,
			),
		).toEqual({ r: 10, g: 20, b: 30, a: 0 });
	});

	test("opaque source at full opacity replaces an opaque backdrop", () => {
		expect(
			blendNormal(
				{ r: 1, g: 2, b: 3, a: 255 },
				{ r: 200, g: 100, b: 50, a: 255 },
				255,
			),
		).toEqual({ r: 200, g: 100, b: 50, a: 255 });
	});
});
