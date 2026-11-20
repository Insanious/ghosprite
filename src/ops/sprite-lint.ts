import { z } from "zod";
import {
	colorUsage,
	contentBounds,
	imageLayers,
	isLayerVisible,
	nearColorPairs,
	type Rect,
	type Rgba,
	renderFrame,
	rgbaHex,
	strayPixels,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import { checkFrames, requireRgba } from "../target.ts";
import { defineOp } from "./registry.ts";

const MAX_STRAY_PIXELS = 100;

type Use = {
	layerId: string;
	frame: number;
	pixels: number;
	bounds: Rect;
};

export const spriteLint = defineOp({
	name: "sprite.lint",
	sprite: "reads",
	description:
		"Check a sprite for defects with a clear right answer and report them with positions. Changes nothing. Checks: stray pixels (opaque pixels with no opaque neighbour, first 100 listed plus the total), near-duplicate colours (every channel within 8, with the layers and frames using each), the colour count, and frames whose lowest non-transparent row differs from the first checked frame's. Also gives each frame's bounds. Colours come from the visible layers' cels; stray pixels and frame bounds use the composited frame without background layers. Uses every frame unless frames is given.",
	input: z.object({
		spriteId: z.string(),
		frames: z
			.array(z.number().int())
			.optional()
			.describe("0-based frames to check. Defaults to every frame."),
	}),
	renderOption: false,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const frames =
			input.frames ?? sprite.frameDurations.map((_, frame) => frame);
		if (frames.length === 0) {
			throw new OpError("invalid_input", "frames is empty", { path: "frames" });
		}
		checkFrames(sprite, frames, "frames");

		const layers = imageLayers(sprite.root).filter((layer) =>
			isLayerVisible(sprite, layer),
		);
		const colors = new Map<string, { color: Rgba; uses: Use[] }>();
		for (const layer of layers) {
			for (const frame of frames) {
				const data = layer.cels.get(frame)?.data;
				if (!data) continue;
				for (const { color, pixels, bounds } of colorUsage(data.image)) {
					const key = rgbaHex(color);
					let entry = colors.get(key);
					if (!entry) {
						entry = { color, uses: [] };
						colors.set(key, entry);
					}
					entry.uses.push({
						layerId: layer.id,
						frame,
						pixels,
						bounds: { ...bounds, x: bounds.x + data.x, y: bounds.y + data.y },
					});
				}
			}
		}
		const distinct = [...colors.entries()];
		const side = ([hex, { uses }]: (typeof distinct)[number]) => ({
			color: hex,
			uses,
		});
		const nearDuplicates = nearColorPairs(
			distinct.map(([, { color }]) => color),
		).map(([i, j]) => ({ a: side(distinct[i]), b: side(distinct[j]) }));

		const stray: { frame: number; x: number; y: number }[] = [];
		let strayPixelCount = 0;
		const frameInfo = frames.map((frame) => {
			const composite = renderFrame(
				sprite,
				frame,
				(layer) => isLayerVisible(sprite, layer) && !layer.flags.background,
			);
			for (const { x, y } of strayPixels(composite)) {
				strayPixelCount += 1;
				if (stray.length < MAX_STRAY_PIXELS) stray.push({ frame, x, y });
			}
			const bounds = contentBounds(composite, 0) ?? null;
			const lowestRow = bounds ? bounds.y + bounds.height - 1 : null;
			return { frame, bounds, lowestRow };
		});
		const expected = frameInfo[0].lowestRow;
		const groundMismatches = frameInfo
			.filter((info) => info.lowestRow !== expected)
			.map(({ frame, lowestRow }) => ({ frame, lowestRow, expected }));

		return {
			colorCount: distinct.length,
			nearDuplicates,
			strayPixels: stray,
			strayPixelCount,
			frames: frameInfo,
			groundMismatches,
		};
	},
});
