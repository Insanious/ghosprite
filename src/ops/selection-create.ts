import { z } from "zod";
import { resolveMask, selectionShapeSchema, storeSelection } from "./mask.ts";
import { defineOp } from "./registry.ts";

export const selectionCreate = defineOp({
	name: "selection.create",
	description:
		"Store a selection under a new id. Use it as `mask: { selectionId }` on draw and filter ops. `all` selects the whole canvas.",
	input: z.object({ spriteId: z.string(), shape: selectionShapeSchema }),
	run(workspace, input) {
		const mask = resolveMask(workspace, input.spriteId, input.shape, "shape");
		const selectionId = workspace.nextId("selection");
		return storeSelection(
			workspace.getSprite(input.spriteId),
			selectionId,
			mask,
		);
	},
});
