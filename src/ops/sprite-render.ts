import { z } from "zod";
import { defineOp } from "./registry.ts";
import {
	renderOptionFields,
	renderPngs,
	selectionIdField,
	withGridRule,
} from "./render.ts";

export const spriteRender = defineOp({
	name: "sprite.render",
	description:
		"Render frames of a sprite as PNGs, optionally upscaled with a pixel grid. Changes nothing.",
	input: withGridRule(
		z.object({
			spriteId: z.string(),
			...renderOptionFields,
			selectionId: selectionIdField,
		}),
	),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const frames =
			input.frames ?? sprite.frameDurations.map((_, frame) => frame);
		const highlight = input.selectionId
			? workspace.getSelection(input.spriteId, input.selectionId)
			: undefined;
		return { render: renderPngs(sprite, input, frames, "", highlight) };
	},
});
