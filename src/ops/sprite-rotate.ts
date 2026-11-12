import { z } from "zod";
import { rotateSprite } from "../core/index.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const spriteRotate = defineOp({
	name: "sprite.rotate",
	sprite: "edits",
	description:
		"Rotate the whole sprite clockwise by 90, 180 or 270 degrees. 90 and 270 swap width and height. Selections turn with it. Slices are not moved.",
	input: z.object({
		spriteId: z.string(),
		angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		rotateSprite(sprite, input.angle);
		return {
			changed: wholeCanvas(sprite, 0, sprite.frameDurations.length - 1),
		};
	},
});
