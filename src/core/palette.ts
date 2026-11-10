import type { Rgba } from "./image.ts";
import type { Sprite } from "./sprite.ts";

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

export function setPalette(sprite: Sprite, frame: number, colors: Rgba[]) {
	const existing = sprite.palettes.find((p) => p.startFrame === frame);
	if (existing) {
		existing.colors = colors;
		return;
	}
	sprite.palettes.push({ startFrame: frame, colors });
	sprite.palettes.sort((a, b) => a.startFrame - b.startFrame);
}

/** The first entry exactly equal to `#00000000`, or -1. */
export function findMaskColor(colors: readonly Rgba[]): number {
	return colors.findIndex(
		(c) => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0,
	);
}
