import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { pointSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";

export const drawPolygon = defineOp({
	name: "draw.polygon",
	sprite: "edits",
	description:
		"Fill the polygon through the points with a brush and ink. It is always filled: for an outline, use draw.line with the first point repeated at the end.",
	input: z.object({
		...drawFields,
		points: z.array(pointSchema).min(3),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, { kind: "polygon", points: input.points });
	},
});
