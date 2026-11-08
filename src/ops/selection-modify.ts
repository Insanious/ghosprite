import { z } from "zod";
import { modifyMask } from "../core/modify-selection.ts";
import { maskPixelCount } from "../core/selection.ts";
import { defineOp } from "./registry.ts";

export const selectionModify = defineOp({
	name: "selection.modify",
	description:
		"Expand a selection, contract it or reduce it to its border by quantity pixels, in place. The result is clipped to the canvas.",
	input: z.object({
		spriteId: z.string(),
		selectionId: z.string(),
		modifier: z.enum(["expand", "contract", "border"]),
		quantity: z.number().int().min(1).max(100),
		brush: z.enum(["circle", "square"]).default("circle"),
	}),
	run(workspace, input) {
		const current = workspace.getSelection(input.spriteId, input.selectionId);
		const sprite = workspace.getSprite(input.spriteId);
		const mask = modifyMask(
			current,
			input.modifier,
			input.quantity,
			input.brush,
			sprite,
		);
		sprite.selections.set(input.selectionId, mask);
		return {
			selectionId: input.selectionId,
			bounds: mask.bounds,
			pixels: maskPixelCount(mask),
		};
	},
});
