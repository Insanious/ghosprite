import { z } from "zod";
import { indexOfNamed } from "./named.ts";
import { defineOp } from "./registry.ts";

export const tagDelete = defineOp({
	name: "tag.delete",
	sprite: "edits",
	description: "Remove the tag with this name.",
	input: z.object({ spriteId: z.string(), name: z.string() }),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		sprite.tags.splice(indexOfNamed(sprite.tags, input.name, "tag"), 1);
		return {};
	},
});
