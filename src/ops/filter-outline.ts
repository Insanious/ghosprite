import { z } from "zod";
import { outline } from "../core/filter/outline.ts";
import { paletteAt } from "../core/palette.ts";
import { colorSchema, toRgba } from "./color.ts";
import { tiledSchema } from "./draw-options.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterOutline = defineOp({
	name: "filter.outline",
	sprite: "edits",
	description:
		"Draw an outline around the content of a layer's cels, like Aseprite's Outline. With place 'outside', transparent pixels next to content take `color`, so the cel can grow; with 'inside', content pixels next to transparent ones do. A pixel is transparent when its alpha is 0 or it equals `bgColor`. `matrix` picks which neighbours count. Targets red, green, blue and alpha by default. `tiled` wraps neighbours at the canvas edges; otherwise the edge pixels repeat.",
	input: z.object({
		...filterFields,
		color: colorSchema,
		bgColor: colorSchema.default("#00000000"),
		place: z.enum(["outside", "inside"]).default("outside"),
		matrix: z
			.enum(["circle", "square", "horizontal", "vertical"])
			.default("circle"),
		tiled: tiledSchema.describe(
			"Wrap the neighbours around these canvas edges",
		),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const palette = paletteAt(sprite.palettes, input.frames[0]);
		const filter = outline({
			color: toRgba(input.color, "color", palette),
			bgColor: toRgba(input.bgColor, "bgColor", palette),
			place: input.place,
			matrix: input.matrix,
			tiled: input.tiled,
		});
		return runFilter(workspace, input, filter, ["r", "g", "b", "a"]);
	},
});
