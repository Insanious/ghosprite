import {
	type DitheringAlgorithm,
	type DitheringMatrix,
	mapImageToPalette,
} from "./dither.ts";
import { isEmptyRect, type Rect, type Rgba } from "./image.ts";
import { OctreeMap } from "./octree-map.ts";
import { findMaskColor, paletteAt } from "./palette.ts";
import {
	type CelDataId,
	celCanvasRect,
	findBackground,
	framesSharingData,
	imageLayers,
	type Sprite,
} from "./sprite.ts";

export type MappedRect = { layerId: string; frame: number; rect: Rect };

/**
 * Replaces every pixel of every cel with a colour of the palette in effect at
 * its frame, and makes each cel opaque. Returns one rect per frame whose cel
 * has pixels on the canvas.
 */
export function mapSpriteToPalette(
	sprite: Sprite,
	options: {
		dithering: DitheringAlgorithm;
		matrix: DitheringMatrix;
		factor: number;
	},
): MappedRect[] {
	const hasBackground = findBackground(sprite) !== undefined;
	const transparentIndex = Math.max(
		findMaskColor(paletteAt(sprite.palettes, 0).colors),
		0,
	);
	const maps = new Map<Rgba[], { map: OctreeMap; maskIndex: number }>();
	const changed: MappedRect[] = [];

	for (const layer of imageLayers(sprite.root)) {
		const converted = new Set<CelDataId>();
		for (const frame of [...layer.cels.keys()].sort((a, b) => a - b)) {
			const data = layer.cels.get(frame)?.data;
			if (!data || converted.has(data.id)) continue;
			converted.add(data.id);

			const { colors } = paletteAt(sprite.palettes, frame);
			let entry = maps.get(colors);
			if (!entry) {
				const found = findMaskColor(colors);
				const maskIndex = found >= 0 ? found : hasBackground ? -1 : 0;
				const map = new OctreeMap();
				map.regenerateMap(colors, maskIndex);
				entry = { map, maskIndex };
				maps.set(colors, entry);
			}
			data.image = mapImageToPalette(data.image, {
				palette: colors,
				map: entry.map,
				maskIndex: entry.maskIndex,
				transparentIndex,
				background: layer.flags.background,
				...options,
			});
			data.opacity = 255;

			const rect = celCanvasRect(sprite, data);
			if (isEmptyRect(rect)) continue;
			for (const shared of framesSharingData(layer, data)) {
				changed.push({ layerId: layer.id, frame: shared, rect });
			}
		}
	}
	return changed;
}
