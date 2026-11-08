import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields, pointSchema } from "./draw-options.ts";
import { defineOp } from "./registry.ts";

export const drawLine = defineOp({
	name: "draw.line",
	description:
		"Draw a line, or a polyline through several points, with a brush and ink. A single point stamps the brush once.",
	input: z.object({
		...drawFields,
		points: z.array(pointSchema).min(1),
		pixelPerfect: z.boolean().default(false),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, {
			kind: "line",
			points: input.points,
			pixelPerfect: input.pixelPerfect,
		});
	},
});
