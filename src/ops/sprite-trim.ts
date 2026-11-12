import { z } from "zod";
import { cropSprite, trimmedBounds } from "../core/index.ts";
import { requireRgba } from "../target.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const spriteTrim = defineOp({
	name: "sprite.trim",
	sprite: "edits",
	description:
		"Crop the canvas to the union of every frame's content bounds, as rendered. Does nothing if no frame has content.",
	input: z.object({ spriteId: z.string() }),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const bounds = trimmedBounds(sprite);
		if (!bounds) return {};
		cropSprite(sprite, bounds);
		return {
			changed: wholeCanvas(sprite, 0, sprite.frameDurations.length - 1),
		};
	},
});
