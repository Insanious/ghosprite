import type { Rgba } from "../image.ts";
import { type Filter, targetedBytes } from "./filter.ts";

/**
 * Pixels within `tolerance` of a pair's `from` on every targeted channel take that pair's `to`
 * on the targeted channels. The first matching pair wins, and matching reads only `src`.
 */
export function replaceColor(
	pairs: { from: Rgba; to: Rgba }[],
	tolerance: number,
): Filter {
	const bytes = pairs.map(({ from, to }) => ({
		from: [from.r, from.g, from.b, from.a],
		to: [to.r, to.g, to.b, to.a],
	}));
	return (src, dst, area, channels) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				const pair = bytes.find(({ from }) =>
					from.every(
						(value, c) =>
							!targeted[c] || Math.abs(src.data[at + c] - value) <= tolerance,
					),
				);
				if (!pair) continue;
				for (let c = 0; c < 4; c++) {
					if (targeted[c]) dst.data[at + c] = pair.to[c];
				}
			}
		}
	};
}
