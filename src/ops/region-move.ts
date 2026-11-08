import { z } from "zod";
import { regionFields, runRegion } from "./region.ts";
import { defineOp } from "./registry.ts";

export const regionMove = defineOp({
	name: "region.move",
	description:
		"Move the pixels inside a stored selection on one layer by (dx, dy), over any set of frames, and move the selection with them. Lifted pixels become `fill`; moved pixels replace what is under them, transparent ones included. Pixels moved off the canvas stay in the cel on a normal layer. Not checked against Aseprite, which cannot script this move headlessly.",
	input: z.object({
		...regionFields,
		dx: z.number().int(),
		dy: z.number().int(),
	}),
	run(workspace, input) {
		return runRegion(workspace, input, (image, bounds) => ({
			image,
			bounds: { ...bounds, x: bounds.x + input.dx, y: bounds.y + input.dy },
		}));
	},
});
