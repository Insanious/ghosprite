import { z } from "zod";
import { commitCel } from "../core/cel-edit.ts";
import { intersectRects, isEmptyRect, unionRects } from "../core/image.ts";
import { resolveTarget } from "./draw.ts";
import { defineOp } from "./registry.ts";
import { imageFromRows, legendSchema, rowsSchema } from "./rows.ts";

export const celSet = defineOp({
	name: "cel.set",
	description:
		"Replace a cel's image, position and opacity from rows of legend characters, creating the cel if needed.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frame: z.number().int().min(0),
		x: z.number().int().default(0),
		y: z.number().int().default(0),
		opacity: z.number().int().min(0).max(255).default(255),
		legend: legendSchema,
		rows: rowsSchema,
	}),
	run(workspace, input) {
		const { sprite, layer } = resolveTarget(
			workspace,
			input.spriteId,
			input.layerId,
			input.frame,
		);
		const image = imageFromRows(input.legend, input.rows);

		const commit = commitCel(sprite, layer, input.frame, {
			image,
			x: input.x,
			y: input.y,
		});
		let rect = commit.rect;
		const cel = layer.cels.get(input.frame);
		if (cel && cel.data.opacity !== input.opacity) {
			cel.data.opacity = input.opacity;
			rect = unionRects(
				rect,
				intersectRects(
					{
						x: cel.data.x,
						y: cel.data.y,
						width: cel.data.image.width,
						height: cel.data.image.height,
					},
					{ x: 0, y: 0, width: sprite.width, height: sprite.height },
				),
			);
		}
		return {
			changed: isEmptyRect(rect)
				? []
				: commit.frames.map((frame) => ({ layerId: layer.id, frame, rect })),
		};
	},
});
