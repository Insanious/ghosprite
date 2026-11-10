import { blendNormal } from "./blend.ts";
import { algoEllipsefill } from "./draw/algo.ts";
import { floodfill } from "./draw/floodfill.ts";
import { maskFromBits } from "./draw/mask.ts";
import type { Mask } from "./draw/spans.ts";
import { recordSelections } from "./history.ts";
import {
	copyImage,
	createImage,
	type Image,
	isEmptyRect,
	type Rect,
	type Rgba,
	unionRects,
} from "./image.ts";
import type { Sprite } from "./sprite.ts";

export type CombineMode = "add" | "subtract" | "intersect";

const EMPTY_BOUNDS: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function emptyMask(): Mask {
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

/** The canvas pixels the mask leaves out. An empty mask inverts to the whole canvas. */
export function invertMask(
	mask: Mask,
	canvas: { width: number; height: number },
): Mask {
	const bits = new Uint8Array(canvas.width * canvas.height);
	for (let y = 0; y < canvas.height; y++) {
		for (let x = 0; x < canvas.width; x++) {
			if (!isSet(mask, x, y)) bits[y * canvas.width + x] = 1;
		}
	}
	return trimMask({
		bounds: { x: 0, y: 0, width: canvas.width, height: canvas.height },
		bits,
	});
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

export function setSelection(sprite: Sprite, id: string, mask: Mask): void {
	recordSelections(sprite);
	sprite.selections.set(id, mask);
}

export function deleteSelection(sprite: Sprite, id: string): void {
	recordSelections(sprite);
	sprite.selections.delete(id);
}

/** Replaces each non-empty selection with `transform` of it, keeping creation order. */
export function transformSelections(
	sprite: Sprite,
	transform: (mask: Mask) => Mask,
): void {
	const isEmpty = (mask: Mask) =>
		mask.bounds.width === 0 || mask.bounds.height === 0;
	if (![...sprite.selections.values()].some((mask) => !isEmpty(mask))) return;
	recordSelections(sprite);
	for (const [id, mask] of sprite.selections) {
		if (isEmpty(mask)) continue;
		sprite.selections.set(id, transform(mask));
	}
}

/** The mask's bits as an indexed image, so image ops can move them. */
export function maskAsImage(mask: Mask): Image {
	return {
		width: mask.bounds.width,
		height: mask.bounds.height,
		mode: "indexed",
		data: mask.bits,
	};
}

const HIGHLIGHT: Rgba = { r: 255, g: 0, b: 255, a: 128 };

/** A copy of an RGBA image with the highlight colour composited over each selected pixel. */
export function highlightMask(image: Image, mask: Mask): Image {
	const result = copyImage(image);
	const { bounds, bits } = mask;
	for (let row = 0; row < bounds.height; row++) {
		for (let col = 0; col < bounds.width; col++) {
			if (bits[row * bounds.width + col] === 0) continue;
			const x = bounds.x + col;
			const y = bounds.y + row;
			if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
			const at = (y * image.width + x) * 4;
			const out = blendNormal(
				{
					r: result.data[at] ?? 0,
					g: result.data[at + 1] ?? 0,
					b: result.data[at + 2] ?? 0,
					a: result.data[at + 3] ?? 0,
				},
				HIGHLIGHT,
				255,
			);
			result.data.set([out.r, out.g, out.b, out.a], at);
		}
	}
	return result;
}

type Offset = { x: number; y: number };

/** The cel's image laid on a transparent canvas-sized image. */
function placeOnCanvas(
	image: Image,
	offset: Offset,
	canvas: { width: number; height: number },
): Image {
	const placed = createImage(canvas.width, canvas.height, "rgba");
	for (let row = 0; row < image.height; row++) {
		const y = offset.y + row;
		if (y < 0 || y >= canvas.height) continue;
		for (let col = 0; col < image.width; col++) {
			const x = offset.x + col;
			if (x < 0 || x >= canvas.width) continue;
			const from = (row * image.width + col) * 4;
			placed.data.set(
				image.data.subarray(from, from + 4),
				(y * canvas.width + x) * 4,
			);
		}
	}
	return placed;
}

/** The pixels a paint bucket would fill from `point`, on the cel laid over the canvas. */
export function maskFromWand(
	image: Image,
	offset: Offset,
	canvas: { width: number; height: number },
	point: Offset,
	tolerance: number,
	contiguous: boolean,
): Mask {
	const placed = placeOnCanvas(image, offset, canvas);
	const at = (point.y * canvas.width + point.x) * 4;
	const seed = {
		r: placed.data[at] ?? 0,
		g: placed.data[at + 1] ?? 0,
		b: placed.data[at + 2] ?? 0,
		a: placed.data[at + 3] ?? 0,
	};
	const bits = new Uint8Array(canvas.width * canvas.height);
	floodfill(
		placed,
		undefined,
		point.x,
		point.y,
		{ x: 0, y: 0, width: canvas.width, height: canvas.height },
		seed,
		tolerance,
		contiguous,
		false,
		(x1, y, x2) =>
			bits.fill(1, y * canvas.width + x1, y * canvas.width + x2 + 1),
	);
	return trimMask(maskFromBits(0, 0, canvas.width, canvas.height, bits));
}

/** The cel's pixels whose r, g, b and a are each within `tolerance` of `color`. */
export function maskFromColor(
	image: Image,
	offset: Offset,
	color: Rgba,
	tolerance: number,
): Mask {
	const bits = new Uint8Array(image.width * image.height);
	const target = [color.r, color.g, color.b, color.a];
	for (let i = 0; i < bits.length; i++) {
		let matches = true;
		for (let c = 0; c < 4; c++) {
			if (
				Math.abs((image.data[i * 4 + c] ?? 0) - (target[c] ?? 0)) > tolerance
			) {
				matches = false;
				break;
			}
		}
		if (matches) bits[i] = 1;
	}
	return trimMask(
		maskFromBits(offset.x, offset.y, image.width, image.height, bits),
	);
}

/** The cel's pixels with alpha above 0. */
export function maskFromContent(image: Image, offset: Offset): Mask {
	const bits = new Uint8Array(image.width * image.height);
	for (let i = 0; i < bits.length; i++) {
		if ((image.data[i * 4 + 3] ?? 0) > 0) bits[i] = 1;
	}
	return trimMask(
		maskFromBits(offset.x, offset.y, image.width, image.height, bits),
	);
}
