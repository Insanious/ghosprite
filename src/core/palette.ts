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
