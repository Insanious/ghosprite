import { z } from "zod";
import { combineMasks } from "../core/index.ts";
import { resolveMask, selectionShapeSchema, storeSelection } from "./mask.ts";
import { defineOp } from "./registry.ts";

export const selectionCombine = defineOp({
	name: "selection.combine",
	sprite: "edits",
	description:
		"Add a shape to a selection, subtract it, or intersect with it, changing the selection in place.",
	input: z.object({
		spriteId: z.string(),
		selectionId: z.string(),
		shape: selectionShapeSchema,
		mode: z.enum(["add", "subtract", "intersect"]),
	}),
	run(workspace, input) {
		const current = workspace.getSelection(input.spriteId, input.selectionId);
		const shape = resolveMask(workspace, input.spriteId, input.shape, "shape");
		const mask = combineMasks(current, shape, input.mode);
		return storeSelection(
			workspace.getSprite(input.spriteId),
			input.selectionId,
			mask,
		);
	},
});
