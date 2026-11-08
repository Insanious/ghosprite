import { z } from "zod";
import { OpError } from "../errors.ts";
import { runDraw } from "./draw.ts";
import { drawFields, pointSchema } from "./draw-options.ts";
import { defineOp } from "./registry.ts";

export const drawFill = defineOp({
	name: "draw.fill",
	description:
		"Flood-fill the area around a point with a colour and ink, like a paint bucket. The brush is not used. A mask walls the fill in.",
	input: z.object({
		...drawFields,
		point: pointSchema,
		contiguous: z
			.boolean()
			.default(true)
			.describe("Fill only the connected area, not every matching pixel"),
		tolerance: z
			.number()
			.int()
			.min(0)
			.max(255)
			.default(0)
			.describe("How far each channel may differ from the clicked colour"),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const { x, y } = input.point;
		if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) {
			throw new OpError(
				"out_of_range",
				`Point (${x}, ${y}) is outside the ${sprite.width}x${sprite.height} canvas`,
				{ path: "point" },
			);
		}
		return runDraw(workspace, input, {
			kind: "fill",
			point: input.point,
			contiguous: input.contiguous,
			tolerance: input.tolerance,
		});
	},
});
