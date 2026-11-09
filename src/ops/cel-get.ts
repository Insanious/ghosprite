import { z } from "zod";
import { cropImage } from "../core/crop.ts";
import { createImage, type Image } from "../core/image.ts";
import { paletteAt } from "../core/palette.ts";
import { renderFrame } from "../core/render.ts";
import { OpError } from "../errors.ts";
import { checkFrame, resolveTarget } from "../target.ts";
import { rectSchema } from "./geometry.ts";
import { defineOp } from "./registry.ts";
import { legendSchema, rowsFromImage } from "./rows.ts";

const MAX_PIXELS = 16384;
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

export const celGet = defineOp({
	name: "cel.get",
	description:
		"Read pixels back as rows of legend characters, plus x, y, width, height of the area read. With layerId, reads that layer's cel as stored (ignoring opacity, blend mode and visibility) and returns its opacity; with no rect it reads the whole cel. Without layerId, reads the composited frame of the visible layers, the whole canvas if there is no rect. A rect reaching past the cel or canvas reads transparent there. Pass a legend to keep your own characters: matching colours reuse them, and new colours get characters the legend doesn't use. Trailing transparent is trimmed from each row. The output works with cel.set and draw.image. Reads at most 16384 pixels.",
	input: z.object({
		spriteId: z.string(),
		frame: z.number().int().min(0),
		layerId: z.string().optional(),
		rect: rectSchema.optional(),
		legend: legendSchema.optional(),
	}),
	renderOption: false,
	readOnly: true,
	run(workspace, input) {
		let source: { image: Image; x: number; y: number };
		let opacity: number | undefined;
		let area = input.rect;
		const sprite = workspace.getSprite(input.spriteId);
		if (input.layerId === undefined) {
			checkFrame(sprite, input.frame);
			source = { image: renderFrame(sprite, input.frame), x: 0, y: 0 };
			area ??= { x: 0, y: 0, width: sprite.width, height: sprite.height };
		} else {
			const target = resolveTarget(
				workspace,
				input.spriteId,
				input.layerId,
				input.frame,
			);
			const cel = target.layer.cels.get(input.frame);
			if (!cel && !area) {
				throw new OpError(
					"not_found",
					`Layer "${target.layer.id}" has no cel at frame ${input.frame}`,
					{
						path: "rect",
						hint: "Pass a rect to read transparent pixels there",
					},
				);
			}
			opacity = cel?.data.opacity ?? 255;
			source = cel
				? { image: cel.data.image, x: cel.data.x, y: cel.data.y }
				: { image: createImage(0, 0, "rgba"), x: 0, y: 0 };
			area ??= {
				x: source.x,
				y: source.y,
				width: source.image.width,
				height: source.image.height,
			};
		}

		if (area.width * area.height > MAX_PIXELS) {
			throw new OpError(
				"out_of_range",
				`Reading ${area.width}x${area.height} is ${area.width * area.height} pixels, over the limit of ${MAX_PIXELS}`,
				{ path: "rect", hint: "Read a smaller rect, such as 128x128 at most" },
			);
		}

		const image = cropImage(
			source.image,
			{ ...area, x: area.x - source.x, y: area.y - source.y },
			TRANSPARENT,
		);
		const { legend, rows } = rowsFromImage(
			image,
			paletteAt(sprite.palettes, input.frame),
			input.legend,
		);
		return {
			x: area.x,
			y: area.y,
			width: area.width,
			height: area.height,
			...(opacity === undefined ? {} : { opacity }),
			legend,
			rows,
		};
	},
});
