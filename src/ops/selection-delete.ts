import { z } from "zod";
import { deleteSelection } from "../core/index.ts";
import { defineOp } from "./registry.ts";

export const selectionDelete = defineOp({
	name: "selection.delete",
	sprite: "edits",
	description: "Remove a stored selection.",
	input: z.object({ spriteId: z.string(), selectionId: z.string() }),
	run(workspace, input) {
		workspace.getSelection(input.spriteId, input.selectionId);
		deleteSelection(workspace.getSprite(input.spriteId), input.selectionId);
		return {};
	},
});
