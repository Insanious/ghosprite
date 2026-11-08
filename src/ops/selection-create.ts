import { z } from "zod";
import { maskPixelCount } from "../core/selection.ts";
import { defineOp } from "./registry.ts";
import { resolveShape, selectionShapeSchema } from "./selection-shape.ts";

export const selectionCreate = defineOp({
	name: "selection.create",
	description:
		"Store a selection under a new id. Use it as `mask: { selectionId }` on draw and filter ops. `all` selects the whole canvas.",
	input: z.object({ spriteId: z.string(), shape: selectionShapeSchema }),
	run(workspace, input) {
		const mask = resolveShape(workspace, input.spriteId, input.shape);
		const selectionId = workspace.nextId("selection");
		workspace.getSprite(input.spriteId).selections.set(selectionId, mask);
		return { selectionId, bounds: mask.bounds, pixels: maskPixelCount(mask) };
	},
});
