import { fromRgb, toRgb } from "./filter/hue-saturation.ts";
import type { Rgba } from "./image.ts";

export type RampOptions = {
	darker: number;
	lighter: number;
	/** Degrees per step. */
	hueShift: number;
};

const SHADOW_HUE = 240;
const HIGHLIGHT_HUE = 60;
const SHADOW_SATURATION_PER_STEP = 0.06;
const HIGHLIGHT_SATURATION_PER_STEP = 0.08;

/** Turns `hue` by up to `amount` degrees towards `target` the short way, ties going downwards. */
function turnTowards(hue: number, target: number, amount: number): number {
	const up = (((target - hue) % 360) + 360) % 360;
	const turned =
		up < 180 ? hue + Math.min(amount, up) : hue - Math.min(amount, 360 - up);
	return ((turned % 360) + 360) % 360;
}

/** Colours from dark to light, with `base` itself at index `darker`. */
export function colorRamp(base: Rgba, options: RampOptions): Rgba[] {
	const { darker, lighter, hueShift } = options;
	const hsl = [0, 0, 0];
	fromRgb(false, base.r, base.g, base.b, hsl);
	const [hue, saturation, lightness] = hsl;
	const step = Math.min(
		lightness / (darker + 1),
		(1 - lightness) / (lighter + 1),
	);
	const chromatic = saturation > 0;
	const rgb = [0, 0, 0];

	const at = (k: number, towards: number, saturationChange: number): Rgba => {
		const turned = chromatic
			? turnTowards(hue, towards, Math.abs(k) * hueShift)
			: 0;
		const level = lightness + k * step;
		const sat = chromatic
			? Math.min(1, Math.max(0, saturation + saturationChange * Math.abs(k)))
			: 0;
		toRgb(false, turned, sat, level, rgb);
		return { r: rgb[0], g: rgb[1], b: rgb[2], a: base.a };
	};

	const ramp: Rgba[] = [];
	for (let k = darker; k >= 1; k--) {
		ramp.push(at(-k, SHADOW_HUE, SHADOW_SATURATION_PER_STEP));
	}
	ramp.push({ ...base });
	for (let k = 1; k <= lighter; k++) {
		ramp.push(at(k, HIGHLIGHT_HUE, -HIGHLIGHT_SATURATION_PER_STEP));
	}
	return ramp;
}
