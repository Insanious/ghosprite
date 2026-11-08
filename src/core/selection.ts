import { algoEllipsefill } from "./draw/algo.ts";
import { maskFromBits } from "./draw/mask.ts";
import type { Mask } from "./draw/spans.ts";
import { isEmptyRect, type Rect, unionRects } from "./image.ts";

export type CombineMode = "add" | "subtract" | "intersect";

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, width: 0, height: 0 };

function emptyMask(): Mask {
	return { bounds: { ...EMPTY_BOUNDS }, bits: new Uint8Array(0) };
}

function isSet(mask: Mask, x: number, y: number): boolean {
	const { bounds } = mask;
	const col = x - bounds.x;
	const row = y - bounds.y;
	if (col < 0 || row < 0 || col >= bounds.width || row >= bounds.height) {
		return false;
	}
	return mask.bits[row * bounds.width + col] !== 0;
}

/** A new mask whose bounds are the box around the set bits. */
export function trimMask(mask: Mask): Mask {
	const { bounds, bits } = mask;
	let minX = bounds.width;
	let minY = bounds.height;
	let maxX = -1;
	let maxY = -1;
	for (let row = 0; row < bounds.height; row++) {
		for (let col = 0; col < bounds.width; col++) {
			if (bits[row * bounds.width + col] === 0) continue;
			minX = Math.min(minX, col);
			minY = Math.min(minY, row);
			maxX = Math.max(maxX, col);
			maxY = Math.max(maxY, row);
		}
	}
	if (maxX < 0) return emptyMask();
	const width = maxX - minX + 1;
	const height = maxY - minY + 1;
	const trimmed = new Uint8Array(width * height);
	for (let row = 0; row < height; row++) {
		const start = (minY + row) * bounds.width + minX;
		trimmed.set(bits.subarray(start, start + width), row * width);
	}
	return {
		bounds: { x: bounds.x + minX, y: bounds.y + minY, width, height },
		bits: trimmed,
	};
}

export function combineMasks(a: Mask, b: Mask, mode: CombineMode): Mask {
	const area = unionRects(a.bounds, b.bounds);
	if (isEmptyRect(area)) return emptyMask();
	const bits = new Uint8Array(area.width * area.height);
	for (let row = 0; row < area.height; row++) {
		for (let col = 0; col < area.width; col++) {
			const inA = isSet(a, area.x + col, area.y + row);
			const inB = isSet(b, area.x + col, area.y + row);
			const set =
				mode === "add"
					? inA || inB
					: mode === "subtract"
						? inA && !inB
						: inA && inB;
			if (set) bits[row * area.width + col] = 1;
		}
	}
	return trimMask({ bounds: area, bits });
}

export function maskPixelCount(mask: Mask): number {
	let count = 0;
	for (const bit of mask.bits) if (bit !== 0) count++;
	return count;
}

export function maskFromEllipse(rect: Rect): Mask {
	const { x, y, width, height } = rect;
	const mask = maskFromBits(
		x,
		y,
		width,
		height,
		new Uint8Array(width * height),
	);
	algoEllipsefill(x, y, x + width - 1, y + height - 1, 0, 0, (x1, row, x2) => {
		for (let col = x1; col <= x2; col++) {
			mask.bits[(row - y) * width + col - x] = 1;
		}
	});
	return trimMask(mask);
}
