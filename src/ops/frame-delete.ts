import { z } from "zod";
import { deleteFrame } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { checkFrame } from "../target.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const frameDelete = defineOp({
	name: "frame.delete",
	sprite: "edits",
	description:
		"Remove a frame; later frames shift down. Returns the deleted index as `frame`.",
	input: z.object({
		spriteId: z.string(),
		frame: z.number().int().min(0),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		checkFrame(sprite, input.frame);
		if (sprite.frameDurations.length === 1) {
			throw new OpError("out_of_range", "A sprite needs at least one frame", {
				path: "frame",
				hint: "Delete the sprite instead, or add another frame first",
			});
		}
		const lastBefore = sprite.frameDurations.length - 1;
		deleteFrame(sprite, input.frame);
		return {
			frame: input.frame,
			changed: wholeCanvas(sprite, input.frame, lastBefore),
		};
	},
});
