import { z } from "zod";
import {
	createImage,
	type Image,
	intersectRects,
	isEmptyRect,
	type Rect,
	setPixel,
	unionRects,
} from "../core/image.ts";
import { framesSharingData, setCel } from "../core/sprite.ts";
import { createUserData } from "../core/user-data.ts";
import { OpError } from "../errors.ts";
import { colorSchema, toRgba } from "./color.ts";
import { defineOp } from "./registry.ts";

function boundsOf(image: Image, x: number, y: number): Rect {
	return { x, y, width: image.width, height: image.height };
}

export const celSet = defineOp({
	name: "cel.set",
	description:
		"Replace a cel's image, position and opacity from rows of legend characters, creating the cel if needed.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		frame: z.number().int().min(0),
		x: z.number().int().default(0),
		y: z.number().int().default(0),
		opacity: z.number().int().min(0).max(255).default(255),
		legend: z.record(z.string().regex(/^.$/su), colorSchema),
		rows: z.array(z.string().min(1)).min(1),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		const layer = workspace.getLayer(input.spriteId, input.layerId);
		if (layer.kind !== "image") {
			throw new OpError("invalid_input", `Layer "${layer.id}" is a group`, {
				path: "layerId",
				hint: "Target an image layer",
			});
		}
		if (input.frame >= sprite.frameDurations.length) {
			throw new OpError(
				"out_of_range",
				`Frame ${input.frame} is outside 0..${sprite.frameDurations.length - 1}`,
				{ path: "frame" },
			);
		}
		if (sprite.mode !== "rgba") {
			throw new OpError("unsupported", `Cannot edit a ${sprite.mode} sprite`, {
				hint: "Only RGBA sprites are supported",
			});
		}

		const colors = new Map(
			Object.entries(input.legend).map(([key, color]) => [
				key,
				toRgba(color, `legend.${key}`),
			]),
		);
		const rows = input.rows.map((row) => Array.from(row));
		const width = rows[0]?.length ?? 0;
		const image = createImage(width, rows.length, "rgba");
		rows.forEach((row, y) => {
			if (row.length !== width) {
				throw new OpError(
					"invalid_input",
					`Row has ${row.length} characters, expected ${width}`,
					{ path: `rows.${y}` },
				);
			}
			row.forEach((char, x) => {
				const color = colors.get(char);
				if (!color) {
					throw new OpError(
						"invalid_input",
						`Character "${char}" is not in the legend`,
						{ path: `rows.${y}`, hint: "Add it to the legend" },
					);
				}
				setPixel(image, x, y, [color.r, color.g, color.b, color.a]);
			});
		});

		const edited = { image, x: input.x, y: input.y, opacity: input.opacity };
		const existing = layer.cels.get(input.frame);
		let frames = [input.frame];
		let rect = boundsOf(image, input.x, input.y);
		if (existing) {
			frames = framesSharingData(layer, existing.data);
			rect = unionRects(
				boundsOf(existing.data.image, existing.data.x, existing.data.y),
				rect,
			);
			Object.assign(existing.data, edited);
		} else {
			setCel(sprite, layer, input.frame, {
				...edited,
				userData: createUserData(),
			});
		}

		const clipped = intersectRects(rect, {
			x: 0,
			y: 0,
			width: sprite.width,
			height: sprite.height,
		});
		return {
			changed: isEmptyRect(clipped)
				? []
				: frames.map((frame) => ({ layerId: layer.id, frame, rect: clipped })),
		};
	},
});
