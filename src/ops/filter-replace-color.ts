import { z } from "zod";
import { paletteAt, replaceColor } from "../core/index.ts";
import { colorSchema, toRgba } from "./color.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterReplaceColor = defineOp({
	name: "filter.replaceColor",
	sprite: "edits",
	description:
		"Replace colours on a layer's cels: each `from` becomes its `to`, like Aseprite's Replace Color for one pair. Swapping two colours works in one call. A pixel matches a pair when every targeted channel is within the tolerance of `from`; targeted channels then take `to`'s values. Targets red, green, blue and alpha by default.",
	input: z.object({
		...filterFields,
		pairs: z
			.array(z.object({ from: colorSchema, to: colorSchema }))
			.min(1)
			.describe(
				"Colour pairs, matched against the pixels as they were before the call. The first matching pair wins.",
			),
		tolerance: z.number().int().min(0).max(255).default(0),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const palette = paletteAt(sprite.palettes, input.frames[0]);
		const filter = replaceColor(
			input.pairs.map((pair, i) => ({
				from: toRgba(pair.from, `pairs.${i}.from`, palette),
				to: toRgba(pair.to, `pairs.${i}.to`, palette),
			})),
			input.tolerance,
		);
		return runFilter(workspace, input, filter, ["r", "g", "b", "a"]);
	},
});
