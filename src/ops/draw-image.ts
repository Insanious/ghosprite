import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { defineOp } from "./registry.ts";
import {
	legendSchema,
	rowsSchema,
	rowsWidthSchema,
	splitRows,
} from "./rows.ts";

export const drawImage = defineOp({
	name: "draw.image",
	description:
		"Paint rows of legend characters with their top-left corner at x, y in sprite space, over the pixels already there. Transparent pixels in the rows leave the cel unchanged. Use cel.set to replace a whole cel instead. The result's cel is the cel's bounds after transparent edges are trimmed; changed covers only the pixels that changed.",
	input: z.object(drawFields).omit({ color: true, brush: true }).extend({
		x: z.number().int(),
		y: z.number().int(),
		legend: legendSchema,
		rows: rowsSchema,
		width: rowsWidthSchema,
	}),
	run(workspace, input) {
		const { width } = splitRows(input.rows, input.width);
		const height = input.rows.length;
		const centre = {
			x: input.x + Math.floor(width / 2),
			y: input.y + Math.floor(height / 2),
		};
		return runDraw(
			workspace,
			{
				...input,
				brush: { legend: input.legend, rows: input.rows, width: input.width },
			},
			{ kind: "dots", points: [centre] },
			"",
		);
	},
});
