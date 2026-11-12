import { z } from "zod";
import { invert } from "../core/index.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

export const filterInvert = defineOp({
	name: "filter.invert",
	sprite: "edits",
	description:
		"Invert the colours of a layer's cels, like Aseprite's Invert Color. Targets red, green and blue by default; inverting alpha turns transparent pixels opaque.",
	input: z.object(filterFields),
	run(workspace, input) {
		return runFilter(workspace, input, invert, ["r", "g", "b"]);
	},
});
