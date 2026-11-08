import type { Image, Rgba } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";

const TRANSPARENT_BLACK: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export type QuantizeOptions = {
	maxColors: number;
	withAlpha: boolean;
	/** When false, index 0 is transparent black and the rest take `maxColors - 1`. */
	opaque: boolean;
};

/** Builds a palette from the pixels of RGBA images, skipping alpha-0 pixels. */
export function quantizeImages(
	images: readonly Image[],
	{ maxColors, withAlpha, opaque }: QuantizeOptions,
): Rgba[] {
	const maskColor = opaque ? null : TRANSPARENT_BLACK;
	const feed = (levelDeep: number) => {
		const octree = new OctreeMap();
		for (const image of images) {
			octree.feedWithImage(image, withAlpha, maskColor, levelDeep);
		}
		return octree;
	};
	const shallow = feed(7).makePalette(maxColors);
	return shallow ?? (feed(8).makePalette(maxColors, 8) as Rgba[]);
}
