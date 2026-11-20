import { describe, expect, test } from "bun:test";
import { fromRgb } from "./filter/hue-saturation.ts";
import { type Rgba, rgbaHex } from "./image.ts";
import { colorRamp } from "./ramp.ts";

const rgba = (hex: string, a = 255): Rgba => ({
	r: Number.parseInt(hex.slice(1, 3), 16),
	g: Number.parseInt(hex.slice(3, 5), 16),
	b: Number.parseInt(hex.slice(5, 7), 16),
	a,
});

const ramp = (hex: string, darker: number, lighter: number, hueShift = 10) =>
	colorRamp(rgba(hex), { darker, lighter, hueShift });

function hsl(color: Rgba) {
	const out = [0, 0, 0];
	fromRgb(false, color.r, color.g, color.b, out);
	return { hue: out[0], saturation: out[1], lightness: out[2] };
}

const hues = (colors: Rgba[]) => colors.map((c) => hsl(c).hue);

describe("colorRamp", () => {
	test("turns a yellow base towards orange in shadows and stops at 60 in highlights", () => {
		const colors = ramp("#e8c030", 2, 2);
		expect(colors).toHaveLength(5);
		expect(colors[2]).toEqual(rgba("#e8c030"));
		expect(colors.map(rgbaHex).join(" ")).toBe(
			"#7a3905ff #bd7a0eff #e8c030ff #eae47bff #f1f1c0ff",
		);
		const lightness = colors.map((c) => hsl(c).lightness);
		for (let i = 1; i < lightness.length; i++) {
			expect(lightness[i]).toBeGreaterThan(lightness[i - 1]);
		}
		const [h0, h1, , h3, h4] = hues(colors);
		expect(Math.abs(h0 - 27)).toBeLessThanOrEqual(1);
		expect(Math.abs(h1 - 37)).toBeLessThanOrEqual(1);
		expect(Math.abs(h3 - 57)).toBeLessThanOrEqual(1);
		expect(h4).toBeCloseTo(60, 6);
		const base = hsl(colors[2]).saturation;
		const [s0, s1, , s3, s4] = colors.map((c) => hsl(c).saturation);
		expect(Math.abs(s0 - 0.92)).toBeLessThan(0.02);
		expect(Math.abs(s1 - 0.86)).toBeLessThan(0.02);
		expect(Math.abs(s3 - 0.73)).toBeLessThan(0.02);
		expect(Math.abs(s4 - 0.64)).toBeLessThan(0.02);
		expect(s0).toBeGreaterThan(base);
		expect(s4).toBeLessThan(base);
	});

	test("turns a blue base's highlights downwards through cyan", () => {
		const [d0, d1, , l0, l1] = hues(ramp("#0000ff", 2, 2));
		expect(d0).toBeCloseTo(240, 6);
		expect(d1).toBeCloseTo(240, 6);
		expect(Math.abs(l0 - 230)).toBeLessThanOrEqual(1);
		expect(Math.abs(l1 - 220)).toBeLessThanOrEqual(1);
	});

	test("turns a yellow base's shadows downwards through orange", () => {
		const [d0, d1, , l0, l1] = hues(ramp("#ffff00", 2, 2));
		expect(Math.abs(d0 - 40)).toBeLessThanOrEqual(1);
		expect(Math.abs(d1 - 50)).toBeLessThanOrEqual(1);
		expect(l0).toBeCloseTo(60, 6);
		expect(l1).toBeCloseTo(60, 6);
	});

	test("turns the short way round, wrapping past 360", () => {
		const [d0, d1, , l0, l1] = hues(ramp("#ff00ff", 2, 2, 40));
		expect(d0).toBeCloseTo(240, 6);
		expect(Math.abs(d1 - 260)).toBeLessThanOrEqual(1);
		expect(Math.abs(l0 - 340)).toBeLessThanOrEqual(1);
		expect(Math.abs(l1 - 20)).toBeLessThanOrEqual(1);
	});

	test("keeps a grey base grey", () => {
		for (const c of ramp("#808080", 2, 2)) {
			expect(c.r).toBe(c.g);
			expect(c.g).toBe(c.b);
		}
	});

	test("returns only the base when both counts are 0", () => {
		expect(ramp("#e8c030", 0, 0)).toEqual([rgba("#e8c030")]);
	});

	test("puts the base last with no lighter steps", () => {
		const colors = ramp("#e8c030", 3, 0);
		expect(colors).toHaveLength(4);
		expect(colors[3]).toEqual(rgba("#e8c030"));
	});

	test("keeps the base's alpha", () => {
		const colors = colorRamp(rgba("#e8c030", 128), {
			darker: 2,
			lighter: 2,
			hueShift: 10,
		});
		expect(colors.map((c) => c.a)).toEqual([128, 128, 128, 128, 128]);
	});

	test("never reaches black or white", () => {
		const dark = ramp("#100808", 3, 0);
		expect(dark.map(rgbaHex)).not.toContain("#000000ff");
		const light = ramp("#f8f0f0", 0, 3);
		expect(light.map(rgbaHex)).not.toContain("#ffffffff");
		for (const colors of [dark, light]) {
			const lightness = colors.map((c) => hsl(c).lightness);
			for (let i = 1; i < lightness.length; i++) {
				expect(lightness[i]).toBeGreaterThan(lightness[i - 1]);
			}
		}
	});

	test("gives copies of a black base", () => {
		expect(ramp("#000000", 0, 2).map(rgbaHex)).toEqual([
			"#000000ff",
			"#000000ff",
			"#000000ff",
		]);
	});
});
