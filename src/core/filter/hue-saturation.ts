import { type Filter, targetedBytes } from "./filter.ts";

export type HueSaturationMode = "hslMul" | "hslAdd" | "hsvMul" | "hsvAdd";

export type HueSaturationAdjust = {
	mode: HueSaturationMode;
	/** Degrees. */
	hue: number;
	/** Fractions, -1..1. */
	saturation: number;
	lightness: number;
	alpha: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Writes the RGB of the given hue, saturation and lightness (or value) into `out`. */
function toRgb(
	hsv: boolean,
	hue: number,
	saturation: number,
	level: number,
	out: number[],
) {
	const chroma = hsv
		? level * saturation
		: (1 - Math.abs(2 * level - 1)) * saturation;
	const huePrime = hue / 60;
	const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
	let r = 0;
	let g = 0;
	let b = 0;
	switch (Math.trunc(huePrime)) {
		case 6:
		case 0:
			r = chroma;
			g = x;
			break;
		case 1:
			r = x;
			g = chroma;
			break;
		case 2:
			g = chroma;
			b = x;
			break;
		case 3:
			g = x;
			b = chroma;
			break;
		case 4:
			b = chroma;
			r = x;
			break;
		case 5:
			b = x;
			r = chroma;
			break;
	}
	const m = hsv ? level - chroma : level - chroma / 2;
	out[0] = Math.trunc((r + m) * 255 + 0.5);
	out[1] = Math.trunc((g + m) * 255 + 0.5);
	out[2] = Math.trunc((b + m) * 255 + 0.5);
}

export function hueSaturation(adjust: HueSaturationAdjust): Filter {
	const hsv = adjust.mode.startsWith("hsv");
	const multiply = adjust.mode.endsWith("Mul");
	const rgb = [0, 0, 0];
	return (src, dst, area, channels) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				const [r, g, b] = src.data.subarray(at, at + 3);
				let a = src.data[at + 3];

				const max = Math.max(r, g, b);
				const min = Math.min(r, g, b);
				const spread = max - min;
				const chroma = spread / 255;
				const level = hsv ? max / 255 : (max + min) / 255 / 2;
				let hue = 0;
				let saturation = 0;
				if (spread !== 0) {
					if (max === r) {
						hue = (g / 255 - b / 255) / chroma;
						while (hue < 0) hue += 6;
						hue %= 6;
					} else if (max === g) {
						hue = (b / 255 - r / 255) / chroma + 2;
					} else {
						hue = (r / 255 - g / 255) / chroma + 4;
					}
					hue *= 60;
					saturation = hsv
						? chroma / level
						: chroma / (1 - Math.abs(2 * level - 1));
				}

				let newHue = hue + adjust.hue;
				while (newHue < 0) newHue += 360;
				newHue %= 360;
				const newSaturation = clamp01(
					multiply
						? saturation * (1 + adjust.saturation)
						: saturation + adjust.saturation,
				);
				const newLevel = clamp01(
					multiply ? level * (1 + adjust.lightness) : level + adjust.lightness,
				);
				toRgb(hsv, newHue, newSaturation, newLevel, rgb);

				if (a !== 0 && channels.a) {
					a = Math.min(255, Math.max(0, Math.trunc(a * (1 + adjust.alpha))));
				}
				if (a === 0) {
					dst.data.fill(0, at, at + 4);
					continue;
				}
				for (let c = 0; c < 3; c++) {
					dst.data[at + c] = targeted[c] ? rgb[c] : src.data[at + c];
				}
				dst.data[at + 3] = a;
			}
		}
	};
}
