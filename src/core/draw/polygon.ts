import { type AlgoHLine, algoLineContinuous } from "./algo.ts";

export interface Point {
	x: number;
	y: number;
}

/**
 * Joins the pixel `x` into the sorted scan segments held in `pairs[0..ints)`,
 * where segment `i` is `pairs[2i]..pairs[2i+1]`. Mutates `pairs` and returns
 * the new count of used entries, or `undefined` when the input is invalid.
 */
export function createUnion(
	pairs: number[],
	x: number,
	ints: number,
): number | undefined {
	if (ints === 0) {
		pairs.splice(0, 0, x, x);
		return 2;
	}
	if (ints < 0 || pairs.length < ints || ints === 1) return undefined;
	if (ints % 2 === 1) ints--;

	for (let i = 0; i < ints; i += 2) {
		if (x === pairs[i] - 1) {
			pairs[i] = x;
			return ints;
		}
		if (x < pairs[i] - 1) {
			pairs.splice(i, 0, x, x);
			return ints + 2;
		}
		if (x === pairs[i + 1] + 1 || x === pairs[i + 1]) {
			pairs[i + 1] = x;
			while (ints > i + 2 && pairs[i + 2] <= x + 1) {
				pairs.splice(i + 1, 2);
				ints -= 2;
				if (i + 2 >= pairs.length) break;
			}
			return ints;
		}
		if (x >= pairs[i] && x < pairs[i + 1]) return ints;
	}
	if (x > pairs[ints - 1]) {
		pairs.splice(ints, 0, x, x);
		return ints + 2;
	}
	return undefined;
}

/** Fills the polygon through `points`, calling `hline` for each horizontal run. */
export function fillPolygon(points: readonly Point[], hline: AlgoHLine): void {
	if (points.length === 0) return;

	const verts: Point[] = [points[0]];
	let ymin = points[0].y;
	let ymax = points[0].y;
	for (let i = 1; i < points.length; i++) {
		const last = verts[verts.length - 1];
		const p = points[i];
		if (last.x === p.x && last.y === p.y) continue;
		verts.push(p);
		if (p.y < ymin) ymin = p.y;
		if (p.y > ymax) ymax = p.y;
	}

	const pts: Point[] = [];
	const addPoint = (x: number, y: number): void => {
		const last = pts[pts.length - 1];
		if (!last || last.x !== x || last.y !== y) pts.push({ x, y });
	};
	for (let c = 0; c < verts.length; c++) {
		if (c === verts.length - 1) {
			algoLineContinuous(
				verts[c].x,
				verts[c].y,
				verts[0].x,
				verts[0].y,
				addPoint,
			);
			// A lone pixel must survive, so only drop the closing duplicate when there is more.
			if (pts.length > 1) pts.pop();
		} else {
			algoLineContinuous(
				verts[c].x,
				verts[c].y,
				verts[c + 1].x,
				verts[c + 1].y,
				addPoint,
			);
		}
	}

	const polyInts: number[] = new Array(pts.length).fill(0);
	for (let y = ymin; y <= ymax; y++) {
		let ints = 0;
		for (let i = 0; i < pts.length; i++) {
			const a = pts[i === 0 ? pts.length - 1 : i - 1];
			const b = pts[i];
			if (a.y === b.y) continue;
			const [lo, hi] = a.y < b.y ? [a, b] : [b, a];
			if ((y >= lo.y && y < hi.y) || (y === ymax && y > lo.y && y <= hi.y)) {
				// Single-precision maths, so rounding matches Aseprite.
				const f = Math.fround;
				const slope = f(f((y - lo.y) * (hi.x - lo.x)) / f(hi.y - lo.y));
				polyInts[ints] = Math.trunc(f(f(slope + 0.5) + lo.x));
				ints++;
			}
		}

		const sorted = polyInts.slice(0, ints).sort((p, q) => p - q);
		for (let i = 0; i < ints; i++) polyInts[i] = sorted[i];

		for (const p of pts) {
			if (p.y !== y) continue;
			const next = createUnion(polyInts, p.x, ints);
			if (next !== undefined) ints = next;
		}

		for (let i = 0; i < ints; i += 2) hline(polyInts[i], y, polyInts[i + 1]);
	}
}
