import { z } from "zod";
import { invertMask, maskPixelCount } from "../core/selection.ts";
import { defineOp } from "./registry.ts";

export const selectionInvert = defineOp({
	name: "selection.invert",
	description:
		"Invert a selection within the canvas, in place. An empty selection becomes the whole canvas.",
	input: z.object({ spriteId: z.string(), selectionId: z.string() }),
	run(workspace, input) {
		const current = workspace.getSelection(input.spriteId, input.selectionId);
		const sprite = workspace.getSprite(input.spriteId);
		const mask = invertMask(current, sprite);
		sprite.selections.set(input.selectionId, mask);
		return {
			selectionId: input.selectionId,
			bounds: mask.bounds,
			pixels: maskPixelCount(mask),
		};
	},
});
