import { z } from "zod";
import { removeTag } from "../core/tag.ts";
import { indexOfNamed } from "./named.ts";
import { defineOp } from "./registry.ts";

export const tagDelete = defineOp({
	name: "tag.delete",
	sprite: "edits",
	description: "Remove the tag with this name.",
	input: z.object({ spriteId: z.string(), name: z.string() }),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		removeTag(sprite, indexOfNamed(sprite.tags, input.name, "tag"));
		return {};
	},
});
