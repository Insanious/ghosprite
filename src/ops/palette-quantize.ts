import { z } from "zod";
import { setPalette } from "../core/palette.ts";
import { quantizeSprite } from "../core/quantize-sprite.ts";
import { requireRgba } from "../target.ts";
import { MAX_COLORS } from "./palette.ts";
import { defineOp } from "./registry.ts";

export const paletteQuantize = defineOp({
	name: "palette.quantize",
	sprite: "edits",
	description:
		"Replace the colours of the palette in effect at frame 0 with up to maxColors colours taken from the rendered pixels of every frame. Unless the sprite is a single background layer, index 0 is transparent black and the rest take maxColors - 1. The palette can end up shorter than maxColors. In an RGBA sprite a palette changes no pixels.",
	input: z.object({
		spriteId: z.string(),
		maxColors: z.number().int().min(1).max(MAX_COLORS).default(MAX_COLORS),
		withAlpha: z
			.boolean()
			.default(true)
			.describe(
				"Count alpha when merging colours; false treats pixels as opaque",
			),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const colors = quantizeSprite(sprite, input);
		setPalette(sprite, 0, colors);
		return {};
	},
});
