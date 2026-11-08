import { z } from "zod";
import { resizeImage } from "../core/resize.ts";
import { regionFields, runRegion } from "./region.ts";
import { defineOp } from "./registry.ts";

export const regionScale = defineOp({
	name: "region.scale",
	description:
		"Scale the pixels inside a stored selection on one layer so the selection's bounds become width by height, keeping the top-left corner, over any set of frames, and scale the selection with them. Lifted pixels become `fill`; scaled pixels replace what is under them, transparent ones included. Nearest-neighbour. Not checked against Aseprite, which cannot script this headlessly.",
	input: z.object({
		...regionFields,
		width: z.number().int().min(1).max(65535),
		height: z.number().int().min(1).max(65535),
	}),
	run(workspace, input) {
		return runRegion(workspace, input, (image, bounds) => ({
			image: resizeImage(image, input.width, input.height),
			bounds: { ...bounds, width: input.width, height: input.height },
		}));
	},
});
