import { z } from "zod";
import { flipSprite } from "../core/index.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const spriteFlip = defineOp({
	name: "sprite.flip",
	sprite: "edits",
	description:
		"Mirror the whole sprite. Selections are mirrored with it. Slices are not moved.",
	input: z.object({
		spriteId: z.string(),
		direction: z.enum(["horizontal", "vertical"]),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		flipSprite(sprite, input.direction);
		return {
			changed: wholeCanvas(sprite, 0, sprite.frameDurations.length - 1),
		};
	},
});
