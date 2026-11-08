import type { Tiled } from "../draw/spans.ts";
import { type Filter, targetedBytes } from "./filter.ts";
import { neighbourOffsets } from "./neighbours.ts";

/** Replaces each targeted channel with its median over a `width` x `height` neighbourhood centred at (width / 2, height / 2) rounded down. */
export function despeckle(
	width: number,
	height: number,
	tiled: Tiled | undefined,
): Filter {
	const window = {
		width,
		height,
		centerX: Math.floor(width / 2),
		centerY: Math.floor(height / 2),
	};
	const count = width * height;
	return (src, dst, area, channels, canvas) => {
		const targeted = targetedBytes(channels);
		const values = [0, 1, 2, 3].map(() => new Uint8Array(count));
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				neighbourOffsets(src, canvas, tiled, x, y, window).forEach((at, i) => {
					for (let c = 0; c < 4; c++) values[c][i] = src.data[at + c];
				});
				const out = (y * src.width + x) * 4;
				for (let c = 0; c < 4; c++) {
					if (targeted[c]) dst.data[out + c] = values[c].sort()[count >> 1];
				}
			}
		}
	};
}
