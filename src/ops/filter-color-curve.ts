import { z } from "zod";
import { colorCurve } from "../core/index.ts";
import { filterFields, runFilter } from "./filter.ts";
import { defineOp } from "./registry.ts";

const pointSchema = z.object({
	x: z.number().int().min(0).max(255),
	y: z.number().int().min(0).max(255),
});

export const filterColorCurve = defineOp({
	name: "filter.colorCurve",
	sprite: "edits",
	description:
		"Remap channel values through a curve, like Aseprite's Color Curve. The curve is linear between the points; values left of the first point take its y and values right of the last take its y. Targets red, green and blue by default.",
	input: z.object({
		...filterFields,
		points: z
			.array(pointSchema)
			.min(2)
			.refine(
				(points) => points.every((p, i) => i === 0 || p.x > points[i - 1].x),
				"x must be strictly ascending",
			)
			.describe("Curve points, x strictly ascending, both 0 to 255"),
	}),
	run(workspace, input) {
		return runFilter(workspace, input, colorCurve(input.points), [
			"r",
			"g",
			"b",
		]);
	},
});
