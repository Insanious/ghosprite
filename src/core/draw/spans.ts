import type { Rect } from "../image.ts";

export type Mask = { bounds: Rect; bits: Uint8Array };

export type Tiled = "x" | "y" | "both";

export type SpanClip = {
	canvas: { width: number; height: number };
	tiled?: Tiled;
	mask?: Mask;
};

export type EmitSpan = (x1: number, y: number, x2: number) => void;

export function wrap(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function emitMasked(
	x1: number,
	y: number,
	x2: number,
	mask: Mask | undefined,
	emit: EmitSpan,
) {
	if (!mask) {
		emit(x1, y, x2);
		return;
	}
	const { bounds, bits } = mask;
	if (y < bounds.y || y >= bounds.y + bounds.height) return;
	const first = Math.max(x1, bounds.x);
	const last = Math.min(x2, bounds.x + bounds.width - 1);
	const row = (y - bounds.y) * bounds.width - bounds.x;
	let runStart = -1;
	for (let x = first; x <= last; x++) {
		if (bits[row + x]) {
			if (runStart < 0) runStart = x;
		} else if (runStart >= 0) {
			emit(runStart, y, x - 1);
			runStart = -1;
		}
	}
	if (runStart >= 0) emit(runStart, y, last);
}

export function clipSpan(
	x1: number,
	y: number,
	x2: number,
	clip: SpanClip,
	emit: EmitSpan,
): void {
	const { width, height } = clip.canvas;
	const tiledX = clip.tiled === "x" || clip.tiled === "both";
	const tiledY = clip.tiled === "y" || clip.tiled === "both";
	if (x1 > x2) [x1, x2] = [x2, x1];

	let row = y;
	if (tiledY) row = wrap(y, height);
	else if (y < 0 || y >= height) return;

	if (!tiledX) {
		x1 = Math.max(x1, 0);
		x2 = Math.min(x2, width - 1);
		if (x1 <= x2) emitMasked(x1, row, x2, clip.mask, emit);
		return;
	}

	if (x2 - x1 + 1 >= width) {
		emitMasked(0, row, width - 1, clip.mask, emit);
		return;
	}
	const start = wrap(x1, width);
	const end = start + (x2 - x1);
	if (end < width) {
		emitMasked(start, row, end, clip.mask, emit);
		return;
	}
	emitMasked(start, row, width - 1, clip.mask, emit);
	emitMasked(0, row, end - width, clip.mask, emit);
}
