import type { Rgba } from "../image.ts";
import { type Filter, targetedBytes } from "./filter.ts";

/** Pixels within `tolerance` of `from` on every targeted channel take `to`'s targeted channels. */
export function replaceColor(from: Rgba, to: Rgba, tolerance: number): Filter {
	const fromBytes = [from.r, from.g, from.b, from.a];
	const toBytes = [to.r, to.g, to.b, to.a];
	return (src, dst, area, channels) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				const matches = fromBytes.every(
					(value, c) =>
						!targeted[c] || Math.abs(src.data[at + c] - value) <= tolerance,
				);
				if (!matches) continue;
				for (let c = 0; c < 4; c++) {
					if (targeted[c]) dst.data[at + c] = toBytes[c];
				}
			}
		}
	};
}
