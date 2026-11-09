import { z } from "zod";
import { indexOfNamed } from "./named.ts";
import { defineOp } from "./registry.ts";

export const sliceDelete = defineOp({
	name: "slice.delete",
	sprite: "edits",
	description: "Remove the slice with this name.",
	input: z.object({ spriteId: z.string(), name: z.string() }),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		sprite.slices.splice(indexOfNamed(sprite.slices, input.name, "slice"), 1);
		return {};
	},
});
