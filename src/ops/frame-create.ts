import { z } from "zod";
import { createFrame } from "../core/frames.ts";
import { paletteAt } from "../core/palette.ts";
import { findBackground } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { requireRgba } from "../target.ts";
import { colorSchema, toRgba } from "./color.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const frameCreate = defineOp({
	name: "frame.create",
	description:
		"Insert an empty frame at `at` (default: after the last frame). Returns its index as `frame`. A sprite with a background layer needs `background`, the colour of the new frame's background cel.",
	input: z.object({
		spriteId: z.string(),
		at: z.number().int().min(0).optional(),
		duration: z.number().int().min(1).max(65535).optional(),
		background: colorSchema.optional(),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const count = sprite.frameDurations.length;
		const at = input.at ?? count;
		if (at > count) {
			throw new OpError("out_of_range", `Frame ${at} is outside 0..${count}`, {
				path: "at",
			});
		}
		const hasBackground = findBackground(sprite) !== undefined;
		if (hasBackground && input.background === undefined) {
			throw new OpError(
				"invalid_input",
				"The sprite has a background layer, so the new frame needs a background colour",
				{
					path: "background",
					hint: "Pass the colour that fills the background layer in the new frame",
				},
			);
		}
		if (hasBackground) requireRgba(sprite);
		createFrame(sprite, at, {
			duration: input.duration,
			background:
				hasBackground && input.background
					? toRgba(
							input.background,
							"background",
							paletteAt(sprite.palettes, at),
						)
					: undefined,
		});
		return {
			frame: at,
			changed: wholeCanvas(sprite, at, sprite.frameDurations.length - 1),
		};
	},
});
