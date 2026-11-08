import { z } from "zod";
import { defineOp } from "./registry.ts";
import { renderOptionFields, renderPngs, withGridRule } from "./render.ts";

export const spriteRender = defineOp({
	name: "sprite.render",
	description:
		"Render frames of a sprite as PNGs, optionally upscaled with a pixel grid. Changes nothing.",
	input: withGridRule(
		z.object({ spriteId: z.string(), ...renderOptionFields }),
	),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const frames =
			input.frames ?? sprite.frameDurations.map((_, frame) => frame);
		return { render: renderPngs(sprite, input, frames, "") };
	},
});
