import { z } from "zod";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { pointSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";

export const drawSpray = defineOp({
	name: "draw.spray",
	sprite: "edits",
	description:
		"Scatter the brush at random positions within a radius of each point. The same seed gives the same result.",
	input: z.object({
		...drawFields,
		points: z.array(pointSchema).min(1),
		radius: z.number().int().min(1).max(64).default(8),
		count: z.number().int().min(1).max(1024).default(32),
	}),
	run(workspace, input) {
		return runDraw(workspace, input, {
			kind: "spray",
			points: input.points,
			radius: input.radius,
			count: input.count,
		});
	},
});
