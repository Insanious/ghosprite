import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { rectSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";

export const drawEllipse = defineOp({
	name: "draw.ellipse",
	sprite: "edits",
	description:
		"Draw an ellipse inscribed in a rectangle, outlined or filled, with a brush and ink. The brush is stamped on every pixel of the ellipse, so a bigger brush grows it. For a tilted ellipse, draw it here, select it and turn it with region.rotate.",
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
