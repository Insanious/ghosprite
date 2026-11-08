import { z } from "zod";
import { combineMasks, maskPixelCount } from "../core/selection.ts";
import { defineOp } from "./registry.ts";
import { resolveShape, selectionShapeSchema } from "./selection-shape.ts";

export const selectionCombine = defineOp({
	name: "selection.combine",
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
		const shape = resolveShape(workspace, input.spriteId, input.shape);
		const mask = combineMasks(current, shape, input.mode);
		workspace.getSprite(input.spriteId).selections.set(input.selectionId, mask);
		return {
			selectionId: input.selectionId,
			bounds: mask.bounds,
			pixels: maskPixelCount(mask),
		};
	},
});
