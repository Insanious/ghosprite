import { z } from "zod";
import { resizeSprite } from "../core/resize.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const spriteResize = defineOp({
	name: "sprite.resize",
	description:
		"Scale the sprite to a new size with nearest-neighbour sampling. Cels and slices scale with it.",
	input: z.object({
		spriteId: z.string(),
		width: z.number().int().min(1).max(65535),
		height: z.number().int().min(1).max(65535),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		resizeSprite(sprite, input.width, input.height);
		return {
			changed: wholeCanvas(sprite, 0, sprite.frameDurations.length - 1),
		};
	},
});
