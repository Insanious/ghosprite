import { z } from "zod";
import { brightnessContrast } from "../core/index.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterBrightnessContrast = defineOp({
	name: "filter.brightnessContrast",
	sprite: "edits",
	description:
		"Adjust brightness and contrast on a layer's cels, like Aseprite's Brightness/Contrast. Targets red, green, blue and alpha by default; alpha itself is never changed.",
	input: z.object({
		...filterFields,
		brightness: z.number().int().min(-100).max(100).default(0),
		contrast: z.number().int().min(-100).max(100).default(0),
	}),
	run(workspace, input) {
		const filter = brightnessContrast(
			input.brightness / 100,
			input.contrast / 100,
		);
		return runFilter(workspace, input, filter, ["r", "g", "b", "a"]);
	},
});
