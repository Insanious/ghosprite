import { z } from "zod";
import { cropSprite } from "../core/crop.ts";
import { paletteAt } from "../core/palette.ts";
import { findBackground } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { requireRgba } from "../target.ts";
import { colorSchema, toRgba } from "./color.ts";
import { rectSchema } from "./draw-options.ts";
import { wholeCanvas } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";

export const spriteCrop = defineOp({
	name: "sprite.crop",
	description:
		"Make `rect`, given in the current canvas space, the new canvas. It can shrink and grow the canvas. Cels on ordinary layers move by the rect's origin and are never cut. A background layer is cropped to the new canvas, and new area is filled with `background`, which is required when the sprite has a background layer and `rect` reaches past the canvas. Slices move with the cels.",
	input: z.object({
		spriteId: z.string(),
		rect: rectSchema,
		background: colorSchema.optional(),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const { rect } = input;
		const reachesPast =
			rect.x < 0 ||
			rect.y < 0 ||
			rect.x + rect.width > sprite.width ||
			rect.y + rect.height > sprite.height;
		if (
			reachesPast &&
			findBackground(sprite) !== undefined &&
			input.background === undefined
		) {
			throw new OpError(
				"invalid_input",
				"The sprite has a background layer, so new canvas area needs a background colour",
				{
					path: "background",
					hint: "Pass the colour that fills the new area of the background layer",
				},
			);
		}
		cropSprite(
			sprite,
			rect,
			input.background === undefined
				? undefined
				: toRgba(input.background, "background", paletteAt(sprite.palettes, 0)),
		);
		return {
			changed: wholeCanvas(sprite, 0, sprite.frameDurations.length - 1),
		};
	},
});
