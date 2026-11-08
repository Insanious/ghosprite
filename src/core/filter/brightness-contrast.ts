import { type Filter, targetedBytes } from "./filter.ts";

/** `brightness` and `contrast` are fractions in -1..1. */
export function brightnessContrast(
	brightness: number,
	contrast: number,
): Filter {
	const map = new Uint8Array(256);
	for (let value = 0; value < 256; value++) {
		let y = (contrast + 1) * (value / 255 - 0.5) + 0.5;
		y *= 1 + brightness;
		map[value] = Math.trunc(255.5 * Math.min(1, Math.max(0, y)));
	}
	return (src, dst, area, channels) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				for (let c = 0; c < 3; c++) {
					if (targeted[c]) dst.data[at + c] = map[src.data[at + c]];
				}
			}
		}
	};
}
