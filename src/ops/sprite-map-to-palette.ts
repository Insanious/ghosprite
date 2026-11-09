import { z } from "zod";
import { bayerMatrix, mapImageToPalette } from "../core/dither.ts";
import { isEmptyRect, type Rgba } from "../core/image.ts";
import { OctreeMap } from "../core/octree-map.ts";
import { findMaskColor, paletteAt } from "../core/palette.ts";
import {
	celCanvasRect,
	findBackground,
	framesSharingData,
	imageLayers,
} from "../core/sprite.ts";
import { requireRgba } from "../target.ts";
import { type ChangedRect, defineOp } from "./registry.ts";

const MATRIX_SIZES = { bayer2x2: 2, bayer4x4: 4, bayer8x8: 8 };

export const spriteMapToPalette = defineOp({
	name: "sprite.mapToPalette",
	description:
		"Replace every pixel of every cel with a colour of the palette in effect at its frame, as Aseprite does when it converts an RGBA sprite to indexed and back. The sprite stays RGBA. A palette entry of #00000000 stands for transparency, and every cel becomes fully opaque. Dithering: none, ordered (Aseprite's ordered dithering) old (its older ordered dithering) or errorDiffusion (Floyd-Steinberg).",
	input: z.object({
		spriteId: z.string(),
		dithering: z
			.enum(["none", "ordered", "old", "errorDiffusion"])
			.default("none"),
		matrix: z
			.enum(["bayer2x2", "bayer4x4", "bayer8x8"])
			.default("bayer8x8")
			.describe("The threshold matrix of ordered and old dithering."),
		factor: z
			.number()
			.min(0)
			.max(1)
			.default(1)
			.describe("How much of the error spreads. Used only by errorDiffusion."),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const matrix = bayerMatrix(MATRIX_SIZES[input.matrix]);
		const hasBackground = findBackground(sprite) !== undefined;
		const transparentIndex = Math.max(
			findMaskColor(paletteAt(sprite.palettes, 0).colors),
			0,
		);
		const maps = new Map<Rgba[], { map: OctreeMap; maskIndex: number }>();
		const changed: ChangedRect[] = [];

		for (const layer of imageLayers(sprite.root)) {
			const converted = new Set();
			for (const frame of [...layer.cels.keys()].sort((a, b) => a - b)) {
				const data = layer.cels.get(frame)?.data;
				if (!data || converted.has(data)) continue;
				converted.add(data);

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
					dithering: input.dithering,
					matrix,
					factor: input.factor,
				});
				data.opacity = 255;

				const rect = celCanvasRect(sprite, data);
				if (isEmptyRect(rect)) continue;
				for (const shared of framesSharingData(layer, data)) {
					changed.push({ layerId: layer.id, frame: shared, rect });
				}
			}
		}
		return { changed };
	},
});
