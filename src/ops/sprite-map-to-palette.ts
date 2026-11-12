import { z } from "zod";
import { bayerMatrix, mapSpriteToPalette } from "../core/index.ts";
import { requireRgba } from "../target.ts";
import { defineOp } from "./registry.ts";

const MATRIX_SIZES = { bayer2x2: 2, bayer4x4: 4, bayer8x8: 8 };

export const spriteMapToPalette = defineOp({
	name: "sprite.mapToPalette",
	sprite: "edits",
	description:
		"Replace every pixel of every cel with a colour of the palette in effect at its frame, as Aseprite does when it converts an RGBA sprite to indexed and back. The sprite stays RGBA. A palette entry of #00000000 stands for transparency, and every cel becomes fully opaque. Dithering: none, ordered (Aseprite's ordered dithering) old (its older ordered dithering) or errorDiffusion (Floyd-Steinberg).",
	input: z.object({
		spriteId: z.string(),
		dithering: z
			.enum(["none", "ordered", "old", "errorDiffusion"])
			.default("none"),
		matrix: z
			.enum(["bayer2x2", "bayer4x4", "bayer8x8"])
			.default("bayer8x8")
			.describe("The threshold matrix of ordered and old dithering."),
		factor: z
			.number()
			.min(0)
			.max(1)
			.default(1)
			.describe("How much of the error spreads. Used only by errorDiffusion."),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		const changed = mapSpriteToPalette(sprite, {
			dithering: input.dithering,
			matrix: bayerMatrix(MATRIX_SIZES[input.matrix]),
			factor: input.factor,
		});
		return { changed };
	},
});
