import { type Filter, targetedBytes } from "./filter.ts";

export type CurvePoint = { x: number; y: number };

/** Lookup table of the piecewise linear curve through `points` (x strictly ascending). */
export function curveTable(points: readonly CurvePoint[]): Uint8Array {
	const table = new Uint8Array(256);
	let next = 0;
	for (let x = 0; x < 256; x++) {
		while (next < points.length && x > points[next].x) next++;
		if (next === points.length) {
			table[x] = points[points.length - 1].y;
		} else if (next === 0) {
			table[x] = points[0].y;
		} else {
			const p = points[next - 1];
			const n = points[next];
			table[x] = p.y + Math.trunc(((n.y - p.y) * (x - p.x)) / (n.x - p.x));
		}
	}
	return table;
}

/** Maps each targeted channel through the curve. */
export function colorCurve(points: readonly CurvePoint[]): Filter {
	const table = curveTable(points);
	return (src, dst, area, channels) => {
		const targeted = targetedBytes(channels);
		for (let y = area.y; y < area.y + area.height; y++) {
			for (let x = area.x; x < area.x + area.width; x++) {
				const at = (y * src.width + x) * 4;
				for (let c = 0; c < 4; c++) {
					if (targeted[c]) dst.data[at + c] = table[src.data[at + c]];
				}
			}
		}
	};
}
