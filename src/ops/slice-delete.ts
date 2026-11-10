import { z } from "zod";
import { removeSlice } from "../core/slice.ts";
import { indexOfNamed } from "./named.ts";
import { defineOp } from "./registry.ts";

export const sliceDelete = defineOp({
	name: "slice.delete",
	sprite: "edits",
	description: "Remove the slice with this name.",
	input: z.object({ spriteId: z.string(), name: z.string() }),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		removeSlice(sprite, indexOfNamed(sprite.slices, input.name, "slice"));
		return {};
	},
});
