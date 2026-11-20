import { renderFrame, type Sprite } from "../../src/core/index.ts";
import {
	type Check,
	type EvalDefinition,
	hue,
	luma,
	onSpriteOfSize,
	opaqueColors,
	opaqueCoverage,
} from "../../src/eval/checks.ts";

const SIZE = 24;
const MAX_RED_DISTANCE = 40;
const MIN_APPLE_COVERAGE = 0.15;
const MIN_RED_SHARE = 0.5;
const RAMP_SIZE = 4;
const MIN_SHADE_PIXELS = 2;
const MIN_LUMA_STEP = 20;
const LEAF_HUE = { min: 80, max: 160 };

type Shade = { color: string; count: number; luma: number; hue: number };

function signedHue(degrees: number): number {
	return degrees > 180 ? degrees - 360 : degrees;
}

function parse(color: string): [number, number, number] {
	return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [
		number,
		number,
		number,
	];
}

function reds(sprite: Sprite): Shade[] {
	const shades: Shade[] = [];
	for (const [color, count] of opaqueColors(renderFrame(sprite, 0))) {
		const [r, g, b] = parse(color);
		const degrees = hue(r, g, b);
		if (degrees === null) continue;
		const signed = signedHue(degrees);
		if (Math.abs(signed) <= MAX_RED_DISTANCE) {
			shades.push({ color, count, luma: luma(r, g, b), hue: signed });
		}
	}
	return shades.sort((a, b) => b.luma - a.luma);
}

const apple: Check = {
	name: "apple",
	part: "apple",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const image = renderFrame(sprite, 0);
		const coverage = opaqueCoverage(image);
		const opaque = coverage * SIZE * SIZE;
		const redPixels = reds(sprite).reduce((sum, red) => sum + red.count, 0);
		const share = opaque === 0 ? 0 : redPixels / opaque;
		const detail = `${(coverage * 100).toFixed(1)}% of the canvas is opaque (needs at least ${MIN_APPLE_COVERAGE * 100}%), ${(share * 100).toFixed(1)}% of it red (needs at least ${MIN_RED_SHARE * 100}%)`;
		return {
			pass: coverage >= MIN_APPLE_COVERAGE && share >= MIN_RED_SHARE,
			detail,
		};
	}),
};

const fourReds: Check = {
	name: "four reds",
	part: "four-shade ramp",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const shades = reds(sprite);
		const thin = shades.filter((shade) => shade.count < MIN_SHADE_PIXELS);
		const list = shades.map((s) => `${s.color} x${s.count}`).join(", ");
		const detail = `${shades.length} reds (needs exactly ${RAMP_SIZE}, each at least ${MIN_SHADE_PIXELS} pixels): ${list || "none"}`;
		return {
			pass: shades.length === RAMP_SIZE && thin.length === 0,
			detail,
		};
	}),
};

const rampOrder: Check = {
	name: "ramp order",
	part: "four-shade ramp",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const shades = reds(sprite);
		if (shades.length < 2) {
			return { pass: false, detail: `${shades.length} reds, needs at least 2` };
		}
		let smallest = Number.POSITIVE_INFINITY;
		for (let i = 1; i < shades.length; i++) {
			const step = (shades[i - 1] as Shade).luma - (shades[i] as Shade).luma;
			smallest = Math.min(smallest, step);
		}
		return {
			pass: smallest >= MIN_LUMA_STEP,
			detail: `smallest luma step between reds is ${smallest.toFixed(1)} (needs at least ${MIN_LUMA_STEP})`,
		};
	}),
};

const hueShift: Check = {
	name: "hue shift",
	part: "hue shift",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const shades = reds(sprite);
		if (shades.length < 2) {
			return { pass: false, detail: `${shades.length} reds, needs at least 2` };
		}
		const lightest = shades[0] as Shade;
		const darkest = shades[shades.length - 1] as Shade;
		return {
			pass: lightest.hue > darkest.hue,
			detail: `lightest red is ${lightest.hue.toFixed(0)} degrees from red and darkest ${darkest.hue.toFixed(0)}, positive is towards orange`,
		};
	}),
};

const leaf: Check = {
	name: "leaf",
	part: "leaf",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		for (const color of opaqueColors(renderFrame(sprite, 0)).keys()) {
			const degrees = hue(...parse(color));
			if (
				degrees !== null &&
				degrees >= LEAF_HUE.min &&
				degrees <= LEAF_HUE.max
			) {
				return {
					pass: true,
					detail: `${color} has hue ${degrees.toFixed(0)}`,
				};
			}
		}
		return {
			pass: false,
			detail: `no opaque colour has a hue between ${LEAF_HUE.min} and ${LEAF_HUE.max}`,
		};
	}),
};

const definition: EvalDefinition = {
	parts: ["apple", "four-shade ramp", "hue shift", "leaf"],
	checks: [apple, fourReds, rampOrder, hueShift, leaf],
};

export default definition;
