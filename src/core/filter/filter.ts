import type { CelCanvas } from "../cel-edit.ts";
import { type Mask, wrap } from "../draw/spans.ts";
import { copyImage, type Image, type Rect } from "../image.ts";

export type ChannelName = "r" | "g" | "b" | "a";

export type Channels = { r: boolean; g: boolean; b: boolean; a: boolean };

/**
 * Reads the pixels of `src` inside `area` and writes the filtered result to the same
 * pixels of `dst`, which starts as a copy of `src`. Channels not targeted must keep
 * their value. `canvas` is the sprite canvas in the coordinates of `src`, which can extend
 * past it; filters that read neighbours clamp or wrap at its edges.
 */
export type Filter = (
	src: Image,
	dst: Image,
	area: Rect,
	channels: Channels,
	canvas: Rect,
) => void;

/** Maps `value` into 0..size-1 by wrapping when `wrapped` is set, otherwise by clamping. */
export function edgeCoordinate(
	value: number,
	size: number,
	wrapped: boolean,
): number {
	if (wrapped) return wrap(value, size);
	return Math.min(Math.max(value, 0), size - 1);
}

/** The targeted flags in byte order: r, g, b, a. */
export function targetedBytes(channels: Channels): boolean[] {
	return [channels.r, channels.g, channels.b, channels.a];
}

/**
 * Runs `filter` over `area` (sprite coordinates) of the cel in `canvas`, in place. `canvasRect`
 * is the sprite canvas. With a `mask`, pixels of `area` it leaves out keep their original bytes.
 */
export function filterCanvas(
	canvas: CelCanvas,
	filter: Filter,
	area: Rect,
	channels: Channels,
	canvasRect: Rect,
	mask?: Mask,
): void {
	const source = copyImage(canvas.image);
	const imageArea = { ...area, x: area.x - canvas.x, y: area.y - canvas.y };
	const imageCanvas = { ...canvasRect, x: -canvas.x, y: -canvas.y };
	filter(source, canvas.image, imageArea, channels, imageCanvas);
	if (mask) keepOutsideMask(source, canvas, mask, area);
}

function keepOutsideMask(
	source: Image,
	canvas: CelCanvas,
	mask: Mask,
	area: Rect,
) {
	const { bounds, bits } = mask;
	for (let y = area.y; y < area.y + area.height; y++) {
		for (let x = area.x; x < area.x + area.width; x++) {
			if (bits[(y - bounds.y) * bounds.width + x - bounds.x]) continue;
			const at = ((y - canvas.y) * source.width + x - canvas.x) * 4;
			canvas.image.data.set(source.data.subarray(at, at + 4), at);
		}
	}
}
