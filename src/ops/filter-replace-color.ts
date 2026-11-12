import { z } from "zod";
import { paletteAt, replaceColor } from "../core/index.ts";
import { colorSchema, toRgba } from "./color.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterReplaceColor = defineOp({
	name: "filter.replaceColor",
	sprite: "edits",
	description:
		"Replace one colour with another on a layer's cels, like Aseprite's Replace Color. A pixel matches when every targeted channel is within the tolerance of `from`; targeted channels then take `to`'s values. Targets red, green, blue and alpha by default.",
	input: z.object({
		...filterFields,
		from: colorSchema,
		to: colorSchema,
		tolerance: z.number().int().min(0).max(255).default(0),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const palette = paletteAt(sprite.palettes, input.frames[0]);
		const filter = replaceColor(
			toRgba(input.from, "from", palette),
			toRgba(input.to, "to", palette),
			input.tolerance,
		);
		return runFilter(workspace, input, filter, ["r", "g", "b", "a"]);
	},
});
