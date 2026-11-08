import type { z } from "zod";
import { celCanvas, commitCel } from "../core/cel-edit.ts";
import { createBrush, imageBrush } from "../core/draw/brush.ts";
import {
	maskFromBits,
	maskFromPolygon,
	maskFromRect,
} from "../core/draw/mask.ts";
import type { Mask } from "../core/draw/spans.ts";
import { drawShape, type Shape } from "../core/draw/stroke.ts";
import { isEmptyRect } from "../core/image.ts";
import type { ImageLayer, Sprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import type { Workspace } from "../workspace.ts";
import { toRgba } from "./color.ts";
import type { drawFields } from "./draw-options.ts";
import { imageFromRows } from "./rows.ts";

type DrawInput = z.output<z.ZodObject<typeof drawFields>>;

/** The image layer and sprite an edit targets, rejecting groups, missing frames and non-RGBA sprites. */
export function resolveTarget(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	frame: number,
): { sprite: Sprite; layer: ImageLayer } {
	const sprite = workspace.getSprite(spriteId);
	const layer = workspace.getLayer(spriteId, layerId);
	if (layer.kind !== "image") {
		throw new OpError("invalid_input", `Layer "${layer.id}" is a group`, {
			path: "layerId",
			hint: "Target an image layer",
		});
	}
	if (frame >= sprite.frameDurations.length) {
		throw new OpError(
			"out_of_range",
			`Frame ${frame} is outside 0..${sprite.frameDurations.length - 1}`,
			{ path: "frame" },
		);
	}
	if (sprite.mode !== "rgba") {
		throw new OpError("unsupported", `Cannot edit a ${sprite.mode} sprite`, {
			hint: "Only RGBA sprites are supported",
		});
	}
	return { sprite, layer };
}

function toMask(spec: NonNullable<DrawInput["mask"]>): Mask {
	if ("rect" in spec) return maskFromRect(spec.rect);
	if ("polygon" in spec) return maskFromPolygon(spec.polygon);
	const rows = spec.rows.map((row) => Array.from(row));
	return maskFromBits(
		spec.x,
		spec.y,
		rows[0].length,
		rows.length,
		rows.flatMap((row) => row.map((char) => (char === " " ? 0 : 1))),
	);
}

export function runDraw(workspace: Workspace, input: DrawInput, shape: Shape) {
	const { sprite, layer } = resolveTarget(
		workspace,
		input.spriteId,
		input.layerId,
		input.frame,
	);
	if (input.ink === "eraser" && layer.flags.background) {
		throw new OpError(
			"unsupported",
			"The eraser cannot be used on a background layer",
			{
				path: "ink",
				hint: "Draw with a colour instead, since ghosprite has no background colour",
			},
		);
	}

	const spec = input.brush;
	const isImageBrush = "rows" in spec;
	const brush = isImageBrush
		? imageBrush(imageFromRows(spec.legend, spec.rows, "brush"))
		: createBrush(spec);

	let color = { r: 0, g: 0, b: 0, a: 0 };
	if (input.color !== undefined) {
		color = toRgba(input.color, "color");
	} else if (input.ink !== "eraser" && !isImageBrush) {
		throw new OpError("invalid_input", "Missing colour", {
			path: "color",
			hint: "Pass a colour, or use the eraser ink or an image brush",
		});
	}

	const canvas = celCanvas(sprite, layer, input.frame);
	drawShape(canvas, sprite, shape, {
		color,
		ink: input.ink,
		opacity: input.opacity,
		brush,
		tiled: input.tiled,
		mask: input.mask && toMask(input.mask),
		symmetry: input.symmetry && {
			x:
				input.symmetry.mode === "vertical"
					? undefined
					: (input.symmetry.x ?? sprite.width / 2),
			y:
				input.symmetry.mode === "horizontal"
					? undefined
					: (input.symmetry.y ?? sprite.height / 2),
		},
	});
	const commit = commitCel(sprite, layer, input.frame, canvas);
	return {
		changed: isEmptyRect(commit.rect)
			? []
			: commit.frames.map((frame) => ({
					layerId: layer.id,
					frame,
					rect: commit.rect,
				})),
	};
}
