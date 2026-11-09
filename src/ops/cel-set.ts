import { z } from "zod";
import { paletteAt } from "../core/palette.ts";
import { resolveTarget } from "../target.ts";
import { editCel } from "./cel-edit.ts";
import { defineOp } from "./registry.ts";
import {
	imageFromRows,
	legendSchema,
	rowsSchema,
	rowsWidthSchema,
} from "./rows.ts";

export const celSet = defineOp({
	name: "cel.set",
	description:
		"Replace a cel's image, position and opacity from rows of legend characters, creating the cel if needed. To paint rows over existing pixels instead of replacing the cel, use draw.image. The result's cel is the cel's bounds after transparent edges are trimmed; changed covers only the pixels that changed.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frame: z.number().int().min(0),
		x: z.number().int().default(0),
		y: z.number().int().default(0),
		opacity: z.number().int().min(0).max(255).default(255),
		legend: legendSchema,
		rows: rowsSchema,
		width: rowsWidthSchema,
	}),
	run(workspace, input) {
		const { sprite, layer } = resolveTarget(
			workspace,
			input.spriteId,
			input.layerId,
			input.frame,
		);
		const image = imageFromRows(
			input.legend,
			input.rows,
			paletteAt(sprite.palettes, input.frame),
			"",
			input.width,
		);

		return editCel(
			{ sprite, layer },
			input.frame,
			() => ({ image, x: input.x, y: input.y }),
			input.opacity,
		);
	},
});
