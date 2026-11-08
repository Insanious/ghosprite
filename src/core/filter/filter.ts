import type { Image, Rect } from "../image.ts";

export type Channels = { r: boolean; g: boolean; b: boolean; a: boolean };

/**
 * Reads the pixels of `src` inside `area` and writes the filtered result to the same
 * pixels of `dst`, which starts as a copy of `src`. Channels not targeted must keep
 * their value.
 */
export type Filter = (
	src: Image,
	dst: Image,
	area: Rect,
	channels: Channels,
) => void;

/** The targeted flags in byte order: r, g, b, a. */
export function targetedBytes(channels: Channels): boolean[] {
	return [channels.r, channels.g, channels.b, channels.a];
}
