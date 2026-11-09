import { z } from "zod";
import { invertMask } from "../core/selection.ts";
import { storeSelection } from "./mask.ts";
import { defineOp } from "./registry.ts";

export const selectionInvert = defineOp({
	name: "selection.invert",
	sprite: "edits",
	description:
		"Invert a selection within the canvas, in place. An empty selection becomes the whole canvas.",
	input: z.object({ spriteId: z.string(), selectionId: z.string() }),
	run(workspace, input) {
		const current = workspace.getSelection(input.spriteId, input.selectionId);
		const sprite = workspace.getSprite(input.spriteId);
		const mask = invertMask(current, sprite);
		return storeSelection(sprite, input.selectionId, mask);
	},
});
