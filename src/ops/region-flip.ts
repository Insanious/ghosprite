import { z } from "zod";
import { flipImage } from "../core/flip.ts";
import { regionFields, runRegion } from "./region.ts";
import { defineOp } from "./registry.ts";

export const regionFlip = defineOp({
	name: "region.flip",
	sprite: "edits",
	description:
		"Mirror the pixels inside a stored selection on one layer within the selection's bounds, over any set of frames, and mirror the selection with them. Lifted pixels become `fill`; flipped pixels replace what is under them, transparent ones included. Matches Aseprite's flip of a selection when the cel contains the selection. A selection that sticks out of the cel is flipped around its full bounds, which is not checked against Aseprite.",
	input: z.object({
		...regionFields,
		direction: z.enum(["horizontal", "vertical"]),
	}),
	run(workspace, input) {
		return runRegion(workspace, input, (image, bounds) => {
			flipImage(image, input.direction);
			return { image, bounds };
		});
	},
});
