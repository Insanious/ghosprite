import { z } from "zod";
import type { CelCanvas } from "../core/cel-edit.ts";
import type { Mask } from "../core/draw/spans.ts";
import type { ChannelName, Channels, Filter } from "../core/filter/filter.ts";
import {
	copyImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
} from "../core/image.ts";
import { resolveTargetFrames } from "../target.ts";
import type { Workspace } from "../workspace.ts";
import { editCels } from "./cel-edit.ts";
import { toMask } from "./draw.ts";
import { maskSchema } from "./draw-options.ts";

const channelNames: [ChannelName, ...ChannelName[]] = ["r", "g", "b", "a"];

export const filterFields = {
	spriteId: z.string(),
	layerId: z.string(),
	frames: z
		.array(z.number().int().min(0))
		.min(1)
		.describe(
			"Frames to filter. Linked cels are filtered once, and every frame sharing the cel is reported as changed",
		),
	channels: z
		.array(z.enum(channelNames))
		.min(1)
		.optional()
		.describe(
			"Channels the filter changes. Defaults to what the filter targets in Aseprite. The alpha of a background layer is never changed",
		),
	mask: maskSchema
		.optional()
		.describe(
			"Limit the filter to a rect, a polygon, rows, or a stored selection by id",
		),
};

export type FilterInput = z.output<z.ZodObject<typeof filterFields>>;

/**
 * Runs `filter` over the cel of each frame, over the mask's bounds within the canvas or the whole
 * canvas. The area also covers canvas pixels outside the cel, which count as transparent.
 */
export function runFilter(
	workspace: Workspace,
	input: FilterInput,
	filter: Filter,
	defaultChannels: readonly ChannelName[],
) {
	const { sprite, layer } = resolveTargetFrames(
		workspace,
		input.spriteId,
		input.layerId,
		input.frames,
	);

	const targeted = input.channels ?? defaultChannels;
	const channels: Channels = {
		r: targeted.includes("r"),
		g: targeted.includes("g"),
		b: targeted.includes("b"),
		a: targeted.includes("a") && !layer.flags.background,
	};
	const mask = input.mask && toMask(workspace, input.spriteId, input.mask);
	const canvasRect = { x: 0, y: 0, width: sprite.width, height: sprite.height };
	const area = mask ? intersectRects(mask.bounds, canvasRect) : canvasRect;

	if (isEmptyRect(area)) return { changed: [] };

	return editCels({ sprite, layer }, input.frames, (canvas) => {
		const source = copyImage(canvas.image);
		const imageArea = { ...area, x: area.x - canvas.x, y: area.y - canvas.y };
		const imageCanvas = { ...canvasRect, x: -canvas.x, y: -canvas.y };
		filter(source, canvas.image, imageArea, channels, imageCanvas);
		if (mask) keepOutsideMask(source, canvas, mask, area);
		return canvas;
	});
}

function keepOutsideMask(
	source: Image,
	canvas: CelCanvas,
	mask: Mask,
	area: Rect,
) {
	const { bounds, bits } = mask;
	for (let y = area.y; y < area.y + area.height; y++) {
		for (let x = area.x; x < area.x + area.width; x++) {
			if (bits[(y - bounds.y) * bounds.width + x - bounds.x]) continue;
			const at = ((y - canvas.y) * source.width + x - canvas.x) * 4;
			canvas.image.data.set(source.data.subarray(at, at + 4), at);
		}
	}
}
