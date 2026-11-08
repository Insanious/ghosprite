import type { Rect } from "../image.ts";
import { fillPolygon, type Point } from "./polygon.ts";
import type { Mask } from "./spans.ts";

export function maskFromRect(rect: Rect): Mask {
	return {
		bounds: { ...rect },
		bits: new Uint8Array(rect.width * rect.height).fill(1),
	};
}

/** Bits are row-major, non-zero meaning inside. */
export function maskFromBits(
	x: number,
	y: number,
	width: number,
	height: number,
	bits: ArrayLike<number>,
): Mask {
	return {
		bounds: { x, y, width, height },
		bits: Uint8Array.from(bits, (bit) => (bit ? 1 : 0)),
	};
}

export function maskFromPolygon(points: readonly Point[]): Mask {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	const width = Math.max(...xs) - x + 1;
	const height = Math.max(...ys) - y + 1;
	const mask = maskFromBits(
		x,
		y,
		width,
		height,
		new Uint8Array(width * height),
	);
	fillPolygon(points, (x1, row, x2) => {
		for (let col = x1; col <= x2; col++) {
			mask.bits[(row - y) * width + col - x] = 1;
		}
	});
	return mask;
}
