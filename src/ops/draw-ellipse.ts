import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields, rectSchema } from "./draw-options.ts";
import { defineOp } from "./registry.ts";

export const drawEllipse = defineOp({
	name: "draw.ellipse",
	description:
		"Draw an ellipse inscribed in a rectangle, outlined or filled, with a brush and ink. The brush is stamped on every pixel of the ellipse, so a bigger brush grows it.",
	input: z.object({
		...drawFields,
		rect: rectSchema,
		filled: z.boolean().default(false),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, {
			kind: "ellipse",
			rect: input.rect,
			filled: input.filled,
		});
	},
});
