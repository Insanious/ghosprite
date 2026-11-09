import { z } from "zod";
import { OpError } from "../errors.ts";
import { colorSchema } from "./color.ts";
import { runDraw } from "./draw.ts";
import { drawFields } from "./draw-options.ts";
import { pointSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";
import { imageFromPixels } from "./rows.ts";

const MAX_BOX_PIXELS = 4096 * 4096;

export const drawPixels = defineOp({
	name: "draw.pixels",
	description:
		"Paint single pixels grouped by colour, over the pixels already there. Use it for scattered details where draw.image rows would be mostly transparent. Each point is one pixel in sprite space; points off the canvas are clipped, and a point listed twice is an error. The result's cel is the cel's bounds after transparent edges are trimmed; changed covers only the pixels that changed.",
	input: z
		.object(drawFields)
		.omit({ color: true, brush: true })
		.extend({
			pixels: z
				.array(
					z.object({
						color: colorSchema,
						points: z.array(pointSchema).min(1),
					}),
				)
				.min(1)
				.superRefine((groups, ctx) => {
					const seen = new Set<string>();
					groups.forEach((group, g) => {
						group.points.forEach(({ x, y }, p) => {
							const key = `${x},${y}`;
							if (seen.has(key)) {
								ctx.addIssue({
									code: "custom",
									message: `Point (${x}, ${y}) is listed twice`,
									path: [g, "points", p],
								});
							}
							seen.add(key);
						});
					});
				})
				.describe(
					"Sprite-space points grouped by colour, each painted as one pixel",
				),
		}),
	run(workspace, input) {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const group of input.pixels) {
			for (const point of group.points) {
				minX = Math.min(minX, point.x);
				minY = Math.min(minY, point.y);
				maxX = Math.max(maxX, point.x);
				maxY = Math.max(maxY, point.y);
			}
		}
		const origin = { x: minX, y: minY };
		const width = maxX - minX + 1;
		const height = maxY - minY + 1;
		if (width * height > MAX_BOX_PIXELS) {
			throw new OpError(
				"out_of_range",
				`The points span ${width}x${height} pixels, more than 4096x4096`,
				{
					path: "pixels",
					hint: "The points are too far apart: check for a mistyped coordinate, or split them across calls",
				},
			);
		}
		const centre = {
			x: origin.x + Math.floor(width / 2),
			y: origin.y + Math.floor(height / 2),
		};
		return runDraw(
			workspace,
			{ ...input, brush: { type: "circle", size: 1, angle: 0 } },
			{ kind: "dots", points: [centre] },
			"",
			(palette) =>
				imageFromPixels(input.pixels, origin, width, height, palette, "pixels"),
		);
	},
});
