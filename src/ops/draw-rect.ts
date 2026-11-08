import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields, rectSchema } from "./draw-options.ts";
import { defineOp } from "./registry.ts";

export const drawRect = defineOp({
	name: "draw.rect",
	description:
		"Draw a rectangle, outlined or filled, with a brush and ink. The brush is stamped on every pixel of the rectangle, so a bigger brush grows it.",
	input: z.object({
		...drawFields,
		rect: rectSchema,
		filled: z.boolean().default(false),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, {
			kind: "rect",
			rect: input.rect,
			filled: input.filled,
		});
	},
});
