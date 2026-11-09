import { z } from "zod";
import { hueSaturation } from "../core/filter/hue-saturation.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

const percent = z.number().int().min(-100).max(100).default(0);

export const filterHueSaturation = defineOp({
	name: "filter.hueSaturation",
	sprite: "edits",
	description:
		"Shift hue and adjust saturation, lightness and alpha on a layer's cels, like Aseprite's Hue/Saturation. In the Mul modes saturation, lightness and alpha scale the existing value by a percentage; in the Add modes saturation and lightness add to it. In the HSV modes lightness is the value. Targets red, green, blue and alpha by default; pixels that end up fully transparent become 0,0,0,0.",
	input: z.object({
		...filterFields,
		mode: z.enum(["hslMul", "hslAdd", "hsvMul", "hsvAdd"]).default("hslMul"),
		hue: z.number().int().min(-180).max(180).default(0).describe("Degrees"),
		saturation: percent,
		lightness: percent,
		alpha: percent,
	}),
	run(workspace, input) {
		const filter = hueSaturation({
			mode: input.mode,
			hue: input.hue,
			saturation: input.saturation / 100,
			lightness: input.lightness / 100,
			alpha: input.alpha / 100,
		});
		return runFilter(workspace, input, filter, ["r", "g", "b", "a"]);
	},
});
