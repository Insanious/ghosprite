import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { pointSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";

export const drawBezier = defineOp({
	name: "draw.bezier",
	description:
		"Draw a cubic bezier curve with a brush and ink. The four points are the start, control point 1, control point 2 and the end.",
	input: z.object({
		...drawFields,
		points: z.array(pointSchema).length(4),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, { kind: "bezier", points: input.points });
	},
});
