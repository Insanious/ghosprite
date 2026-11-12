import { z } from "zod";
import { despeckle } from "../core/index.ts";
import { tiledSchema } from "./draw-options.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterDespeckle = defineOp({
	name: "filter.despeckle",
	sprite: "edits",
	description:
		"Median filter on a layer's cels, like Aseprite's Despeckle: each pixel takes the median of each targeted channel over a width x height neighbourhood. Targets red, green and blue by default.",
	input: z.object({
		...filterFields,
		width: z.number().int().min(1).max(100).default(3),
		height: z.number().int().min(1).max(100).default(3),
		tiled: tiledSchema.describe(
			"Wrap neighbouring pixels around these canvas edges",
		),
	}),
	run(workspace, input) {
		return runFilter(
			workspace,
			input,
			despeckle(input.width, input.height, input.tiled),
			["r", "g", "b"],
		);
	},
});
