import type { Rgba } from "./image.ts";

export type Palette = {
	startFrame: number;
	colors: Rgba[];
};

export function paletteAt(palettes: Palette[], frame: number): Palette {
	let found: Palette | undefined;
	for (const palette of palettes) {
		if (
			palette.startFrame <= frame &&
			(!found || palette.startFrame >= found.startFrame)
		) {
			found = palette;
		}
	}
	if (!found) {
		throw new RangeError(`No palette applies at frame ${frame}`);
	}
	return found;
}

/** The first entry exactly equal to `#00000000`, or -1. */
export function findMaskColor(colors: readonly Rgba[]): number {
	return colors.findIndex(
		(c) => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0,
	);
}
