import { describe, expect, test } from "bun:test";
import {
	blendAddition,
	blendColorBurn,
	blendColorDodge,
	blendDifference,
	blendDivide,
	blendHardLight,
	blendMerge,
	blendMultiply,
	blendNormal,
	blendOverlay,
	blendSoftLight,
	blendSubtract,
	div8,
	mul8,
	withNewBlend,
} from "./blend.ts";

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

const opaque = (r: number, g = r, b = r) => ({ r, g, b, a: 255 });

describe("separable blenders over an opaque backdrop", () => {
	test("color-dodge: backdrop 0 gives 0, source 255 gives 255, otherwise b/(1-s)", () => {
		expect(blendColorDodge(opaque(0), opaque(255), 255).r).toBe(0);
		expect(blendColorDodge(opaque(10), opaque(255), 255).r).toBe(255);
		expect(blendColorDodge(opaque(50), opaque(100), 255).r).toBe(div8(50, 155));
	});

	test("color-burn: backdrop 255 gives 255, source 0 gives 0, otherwise 1-(1-b)/s", () => {
		expect(blendColorBurn(opaque(255), opaque(0), 255).r).toBe(255);
		expect(blendColorBurn(opaque(100), opaque(0), 255).r).toBe(0);
		expect(blendColorBurn(opaque(200), opaque(100), 255).r).toBe(
			255 - div8(55, 100),
		);
	});

	test("divide: backdrop 0 gives 0, source 0 gives 255, b >= s gives 255", () => {
		expect(blendDivide(opaque(0), opaque(0), 255).r).toBe(0);
		expect(blendDivide(opaque(5), opaque(0), 255).r).toBe(255);
		expect(blendDivide(opaque(100), opaque(100), 255).r).toBe(255);
		expect(blendDivide(opaque(50), opaque(100), 255).r).toBe(div8(50, 100));
	});

	test("hard light branches at s < 128, and overlay swaps its arguments", () => {
		expect(blendHardLight(opaque(100), opaque(127), 255).r).toBe(
			mul8(100, 254),
		);
		const screened = 100 + 1 - mul8(100, 1);
		expect(blendHardLight(opaque(100), opaque(128), 255).r).toBe(screened);
		expect(blendOverlay(opaque(127), opaque(100), 255).r).toBe(mul8(100, 254));
		expect(blendOverlay(opaque(128), opaque(100), 255).r).toBe(
			100 + 1 - mul8(100, 1),
		);
	});

	test("addition clamps at 255 and subtract is backdrop minus source, clamped at 0", () => {
		expect(blendAddition(opaque(200), opaque(100), 255).r).toBe(255);
		expect(blendAddition(opaque(20), opaque(30), 255).r).toBe(50);
		expect(blendSubtract(opaque(200), opaque(50), 255).r).toBe(150);
		expect(blendSubtract(opaque(50), opaque(200), 255).r).toBe(0);
	});

	test("difference is the absolute difference", () => {
		expect(blendDifference(opaque(50), opaque(200), 255).r).toBe(150);
		expect(blendDifference(opaque(200), opaque(50), 255).r).toBe(150);
	});

	test("soft light in both branches", () => {
		// b = 0.2 <= 0.25, s = 0.4 <= 0.5: r = b - (1 - 2s) * b * (1 - b).
		const b1 = 51 / 255;
		const r1 = b1 - (1 - 2 * (102 / 255)) * b1 * (1 - b1);
		expect(blendSoftLight(opaque(51), opaque(102), 255).r).toBe(
			Math.trunc(r1 * 255 + 0.5),
		);
		// b = 0.64 > 0.25, s = 0.8 > 0.5: d = sqrt(b), r = b + (2s - 1) * (d - b).
		const b2 = 163 / 255;
		const r2 = b2 + (2 * (204 / 255) - 1) * (Math.sqrt(b2) - b2);
		expect(blendSoftLight(opaque(163), opaque(204), 255).r).toBe(
			Math.trunc(r2 * 255 + 0.5),
		);
	});

	test("the blended colour keeps the source alpha and goes through blendNormal", () => {
		const out = blendMultiply(
			opaque(200),
			{ r: 128, g: 128, b: 128, a: 128 },
			255,
		);
		const expected = blendNormal(
			opaque(200),
			{ r: mul8(200, 128), g: mul8(200, 128), b: mul8(200, 128), a: 128 },
			255,
		);
		expect(out).toEqual(expected);
	});
});

describe("blendMerge", () => {
	const from = { r: 10, g: 20, b: 30, a: 255 };
	const to = { r: 110, g: 120, b: 130, a: 255 };

	test("opacity 0 gives the backdrop and 255 gives the source", () => {
		expect(blendMerge(from, to, 0)).toEqual(from);
		expect(blendMerge(from, to, 255)).toEqual(to);
	});

	test("a transparent backdrop takes the source colour", () => {
		const out = blendMerge({ r: 1, g: 1, b: 1, a: 0 }, to, 255);
		expect(out).toEqual(to);
	});

	test("a result alpha of 0 zeroes the colour", () => {
		const out = blendMerge(
			{ r: 1, g: 1, b: 1, a: 0 },
			{ r: 9, g: 9, b: 9, a: 0 },
			255,
		);
		expect(out).toEqual({ r: 0, g: 0, b: 0, a: 0 });
	});
});

describe("withNewBlend", () => {
	const src = { r: 100, g: 100, b: 100, a: 255 };

	test("a transparent backdrop gives exactly blendNormal's result", () => {
		const backdrop = { r: 5, g: 6, b: 7, a: 0 };
		expect(withNewBlend(blendMultiply)(backdrop, src, 200)).toEqual(
			blendNormal(backdrop, src, 200),
		);
	});

	test("an opaque backdrop gives the plain mode result", () => {
		const backdrop = opaque(200);
		expect(withNewBlend(blendMultiply)(backdrop, src, 255)).toEqual(
			blendMultiply(backdrop, src, 255),
		);
	});

	test("a partial backdrop merges normal and the mode", () => {
		const backdrop = { r: 200, g: 200, b: 200, a: 128 };
		const normal = blendNormal(backdrop, src, 255);
		const blend = blendMultiply(backdrop, src, 255);
		const merged = blendMerge(normal, blend, 128);
		const expected = blendMerge(merged, blend, mul8(128, mul8(255, 255)));
		const out = withNewBlend(blendMultiply)(backdrop, src, 255);
		expect(out).toEqual(expected);
		expect(out).not.toEqual(normal);
	});
});
