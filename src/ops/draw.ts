import type { z } from "zod";
import { type Brush, createBrush, imageBrush } from "../core/draw/brush.ts";
import {
	maskFromBits,
	maskFromPolygon,
	maskFromRect,
} from "../core/draw/mask.ts";
import type { Mask } from "../core/draw/spans.ts";
import { drawShape, type Shape, type SprayShape } from "../core/draw/stroke.ts";
import type { Image } from "../core/image.ts";
import { type Palette, paletteAt } from "../core/palette.ts";
import { OpError } from "../errors.ts";
import { resolveTarget } from "../target.ts";
import type { Workspace } from "../workspace.ts";
import { editCel } from "./cel-edit.ts";
import { toRgba } from "./color.ts";
import type { drawFields, maskSchema } from "./draw-options.ts";
import { imageFromRows, splitRows } from "./rows.ts";

type DrawInput = z.output<z.ZodObject<typeof drawFields>>;

export function toMask(
	workspace: Workspace,
	spriteId: string,
	spec: z.output<typeof maskSchema>,
	path = "mask",
): Mask {
	if ("selectionId" in spec) {
		return workspace.getSelection(
			spriteId,
			spec.selectionId,
			`${path}.selectionId`,
		);
	}
	if ("rect" in spec) return maskFromRect(spec.rect);
	if ("polygon" in spec) return maskFromPolygon(spec.polygon);
	const { cells, width } = splitRows(spec.rows, spec.width, path);
	return maskFromBits(
		spec.x,
		spec.y,
		width,
		cells.length,
		cells.flatMap((row) =>
			Array.from({ length: width }, (_, x) =>
				x >= row.length || row[x] === " " || row[x] === "." ? 0 : 1,
			),
		),
	);
}

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
		mask: input.mask && toMask(workspace, input.spriteId, input.mask),
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
