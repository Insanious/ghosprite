import type { CelCanvas } from "./cel-edit.ts";
import type { Mask } from "./draw/spans.ts";
import {
	createImage,
	type Image,
	isEmptyRect,
	type Rect,
	type Rgba,
	unionRects,
} from "./image.ts";

/**
 * Transforms an image placed at `bounds`, returning the result and where it now sits.
 * It may change the input image in place.
 */
export type RegionTransform = (
	image: Image,
	bounds: Rect,
) => { image: Image; bounds: Rect };

/** A canvas covering `canvas` and `rect`, with transparent new pixels. */
export function growCanvas(canvas: CelCanvas, rect: Rect): CelCanvas {
	const current = {
		x: canvas.x,
		y: canvas.y,
		width: canvas.image.width,
		height: canvas.image.height,
	};
	const area = unionRects(current, rect);
	const grown = {
		image: createImage(area.width, area.height, "rgba"),
		x: area.x,
		y: area.y,
	};
	const width = canvas.image.width * 4;
	for (let row = 0; row < canvas.image.height; row++) {
		const to =
			((canvas.y + row - grown.y) * grown.image.width + canvas.x - grown.x) * 4;
		grown.image.data.set(
			canvas.image.data.subarray(row * width, (row + 1) * width),
			to,
		);
	}
	return grown;
}

function forEachSet(
	canvas: CelCanvas,
	mask: Mask,
	visit: (canvasAt: number, maskAt: number) => void,
): void {
	const { bounds, bits } = mask;
	if (isEmptyRect(bounds)) return;
	for (let row = 0; row < bounds.height; row++) {
		for (let col = 0; col < bounds.width; col++) {
			const maskAt = row * bounds.width + col;
			if (bits[maskAt] === 0) continue;
			const x = bounds.x + col - canvas.x;
			const y = bounds.y + row - canvas.y;
			visit((y * canvas.image.width + x) * 4, maskAt);
		}
	}
}

/**
 * The pixels under the mask as an image at the mask's bounds, with unselected pixels transparent.
 * The lifted pixels become `fill` in the canvas, which must cover the mask.
 */
export function liftRegion(canvas: CelCanvas, mask: Mask, fill: Rgba): Image {
	const floating = createImage(mask.bounds.width, mask.bounds.height, "rgba");
	const fillBytes = [fill.r, fill.g, fill.b, fill.a];
	forEachSet(canvas, mask, (canvasAt, maskAt) => {
		floating.data.set(
			canvas.image.data.subarray(canvasAt, canvasAt + 4),
			maskAt * 4,
		);
		canvas.image.data.set(fillBytes, canvasAt);
	});
	return floating;
}

/**
 * Copies the floating pixels to the canvas wherever the mask is set, replacing what is there,
 * transparent pixels included. The canvas must cover the mask.
 */
export function dropRegion(
	canvas: CelCanvas,
	floating: Image,
	mask: Mask,
): void {
	forEachSet(canvas, mask, (canvasAt, maskAt) => {
		canvas.image.data.set(
			floating.data.subarray(maskAt * 4, maskAt * 4 + 4),
			canvasAt,
		);
	});
}
