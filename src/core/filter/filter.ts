import { wrap } from "../draw/spans.ts";
import type { Image, Rect } from "../image.ts";

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
