import { z } from "zod";
import { celCanvas, commitCel } from "../core/cel-edit.ts";
import type { Mask } from "../core/draw/spans.ts";
import { isEmptyRect, unionRects } from "../core/image.ts";
import { paletteAt } from "../core/palette.ts";
import {
	dropRegion,
	growCanvas,
	liftRegion,
	type RegionTransform,
} from "../core/region.ts";
import {
	emptyMask,
	maskAsImage,
	maskPixelCount,
	trimMask,
} from "../core/selection.ts";
import type { CelData } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { resolveTargetFrames } from "../target.ts";
import type { Workspace } from "../workspace.ts";
import { colorSchema, toRgba } from "./color.ts";
import { filterFields } from "./filter.ts";
import type { ChangedRect } from "./registry.ts";

export const regionFields = {
	spriteId: z.string(),
	layerId: z.string(),
	frames: filterFields.frames.describe(
		"Frames to transform. Linked cels are transformed once, and every frame sharing the cel is reported as changed",
	),
	selectionId: z.string(),
	fill: colorSchema
		.optional()
		.describe(
			"Colour left where pixels were lifted. Defaults to transparent; required on a background layer",
		),
};

export type RegionInput = z.output<z.ZodObject<typeof regionFields>>;

/**
 * Lifts the selected pixels of each frame's cel, transforms them together with the stored
 * selection, and drops them where the transformed selection is set.
 */
export function runRegion(
	workspace: Workspace,
	input: RegionInput,
	transform: RegionTransform,
) {
	const { sprite, layer } = resolveTargetFrames(
		workspace,
		input.spriteId,
		input.layerId,
		input.frames,
	);
	if (layer.flags.background && input.fill === undefined) {
		throw new OpError(
			"unsupported",
			"A background layer needs a fill colour for the lifted pixels",
			{
				path: "fill",
				hint: "Pass a colour, since ghosprite has no background colour",
			},
		);
	}
	const selection = workspace.getSelection(input.spriteId, input.selectionId);
	const placed = isEmptyRect(selection.bounds)
		? emptyMask()
		: transformMask(selection, transform);
	const moved = trimMask(placed);

	const changed: ChangedRect[] = [];
	if (!isEmptyRect(selection.bounds)) {
		const area = unionRects(selection.bounds, placed.bounds);
		const done = new Set<CelData>();
		for (const frame of [...new Set(input.frames)].sort((a, b) => a - b)) {
			const cel = layer.cels.get(frame);
			if (!cel || done.has(cel.data)) continue;
			done.add(cel.data);

			const fill =
				input.fill === undefined
					? { r: 0, g: 0, b: 0, a: 0 }
					: toRgba(input.fill, "fill", paletteAt(sprite.palettes, frame));
			const canvas = growCanvas(celCanvas(sprite, layer, frame), area);
			const floating = liftRegion(canvas, selection, fill);
			const result = transform(floating, selection.bounds);
			dropRegion(canvas, result.image, placed);

			const commit = commitCel(sprite, layer, frame, canvas);
			if (isEmptyRect(commit.rect)) continue;
			for (const shared of commit.frames) {
				changed.push({ layerId: layer.id, frame: shared, rect: commit.rect });
			}
		}
	}

	sprite.selections.set(input.selectionId, moved);
	return {
		changed,
		selectionId: input.selectionId,
		bounds: moved.bounds,
		pixels: maskPixelCount(moved),
	};
}

function transformMask(selection: Mask, transform: RegionTransform): Mask {
	const result = transform(
		{ ...maskAsImage(selection), data: selection.bits.slice() },
		selection.bounds,
	);
	return { bounds: result.bounds, bits: result.image.data };
}
