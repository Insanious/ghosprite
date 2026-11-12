import type { z } from "zod";
import {
	type Brush,
	createBrush,
	drawShape,
	type Image,
	imageBrush,
	type Palette,
	paletteAt,
	type Shape,
	type SprayShape,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import { resolveTarget } from "../target.ts";
import type { Workspace } from "../workspace.ts";
import { editCel } from "./cel-edit.ts";
import { toRgba } from "./color.ts";
import type { drawFields } from "./draw-options.ts";
import { resolveMask } from "./mask.ts";
import { imageFromRows } from "./rows.ts";

type DrawInput = z.output<z.ZodObject<typeof drawFields>>;

const COLORLESS_INKS: readonly string[] = ["eraser", "blur", "jumble"];

export function runDraw(
	workspace: Workspace,
	input: DrawInput,
	shape: Shape | SprayShape,
	brushPath = "brush",
	brushFromPalette?: (palette: Palette) => Image,
) {
	const { sprite, layer } = resolveTarget(
		workspace,
		input.spriteId,
		input.layerId,
		input.frame,
	);
	if (input.ink === "eraser" && layer.flags.background) {
		throw new OpError(
			"unsupported",
			"The eraser cannot be used on a background layer",
			{
				path: "ink",
				hint: "Draw with a colour instead, since ghosprite has no background colour",
			},
		);
	}

	const spec = input.brush;
	const isImageBrush = brushFromPalette !== undefined || "rows" in spec;
	const palette = paletteAt(sprite.palettes, input.frame);
	let brush: Brush;
	if (brushFromPalette) {
		brush = imageBrush(brushFromPalette(palette));
	} else if ("rows" in spec) {
		brush = imageBrush(
			imageFromRows(spec.legend, spec.rows, palette, brushPath, spec.width),
		);
	} else {
		brush = createBrush(spec);
	}

	let color = { r: 0, g: 0, b: 0, a: 0 };
	if (input.color !== undefined) {
		color = toRgba(input.color, "color", palette);
	} else if (!COLORLESS_INKS.includes(input.ink) && !isImageBrush) {
		throw new OpError("invalid_input", "Missing colour", {
			path: "color",
			hint: "Pass a colour, or use the eraser, blur or jumble ink or an image brush",
		});
	}

	const options = {
		color,
		ink: input.ink,
		opacity: input.opacity,
		seed: input.seed,
		brush,
		tiled: input.tiled,
		mask:
			input.mask && resolveMask(workspace, input.spriteId, input.mask, "mask"),
		symmetry: input.symmetry && {
			x:
				input.symmetry.mode === "vertical"
					? undefined
					: (input.symmetry.x ?? sprite.width / 2),
			y:
				input.symmetry.mode === "horizontal"
					? undefined
					: (input.symmetry.y ?? sprite.height / 2),
		},
	};
	return editCel({ sprite, layer }, input.frame, (canvas) => {
		drawShape(canvas, sprite, shape, options);
		return canvas;
	});
}
