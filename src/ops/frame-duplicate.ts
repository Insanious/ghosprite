import { z } from "zod";
import { duplicateFrame } from "../core/index.ts";
import { checkFrame } from "../target.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const frameDuplicate = defineOp({
	name: "frame.duplicate",
	sprite: "edits",
	description:
		"Insert a copy of a frame right after it. Cels on continuous layers are linked to the source, the rest are copied. Returns the new frame's index as `frame`.",
	input: z.object({
		spriteId: z.string(),
		frame: z.number().int().min(0),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		checkFrame(sprite, input.frame);
		duplicateFrame(sprite, input.frame);
		return {
			frame: input.frame + 1,
			changed: wholeCanvas(
				sprite,
				input.frame + 1,
				sprite.frameDurations.length - 1,
			),
		};
	},
});
