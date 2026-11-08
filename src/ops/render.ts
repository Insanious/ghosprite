import { deflateSync } from "node:zlib";
import { z } from "zod";
import type { Mask } from "../core/draw/spans.ts";
import { encodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import { highlightMask } from "../core/selection.ts";
import type { Sprite } from "../core/sprite.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";

export const renderOptionFields = {
	scale: z.number().int().min(1).max(64).default(1),
	grid: z.boolean().default(false),
	frames: z.array(z.number().int().min(0)).optional(),
};

const GRID_MIN_SCALE = 4;
const MAX_RENDER_PIXELS = 4096 * 4096;

export function withGridRule<
	T extends z.ZodType<{ scale: number; grid: boolean }>,
>(schema: T) {
	return schema.refine((o) => !o.grid || o.scale >= GRID_MIN_SCALE, {
		path: ["grid"],
		message: `grid needs scale ${GRID_MIN_SCALE} or more`,
	});
}

export const selectionIdField = z
	.string()
	.optional()
	.describe("Highlight this selection on the render");

export const renderOptionSchema = withGridRule(
	z.object({ ...renderOptionFields, selectionId: selectionIdField }),
);

export type RenderOption = z.infer<typeof renderOptionSchema>;

export type RenderedFrame = { frame: number; png: Uint8Array };

export function checkRenderable(
	sprite: Sprite,
	option: { scale: number; grid: boolean },
	frames: number[],
	pathPrefix: string,
) {
	const frameCount = sprite.frameDurations.length;
	for (const frame of frames) {
		if (frame >= frameCount) {
			throw new OpError(
				"out_of_range",
				`Frame ${frame} is out of range, the sprite has ${frameCount} frames`,
				{ path: `${pathPrefix}frames` },
			);
		}
	}
	const gridPixels = option.grid ? 1 : 0;
	checkPixelLimit(
		sprite.width * option.scale + gridPixels,
		sprite.height * option.scale + gridPixels,
		`${pathPrefix}scale`,
	);
}

export function checkPixelLimit(width: number, height: number, path: string) {
	if (width * height > MAX_RENDER_PIXELS) {
		throw new OpError(
			"out_of_range",
			`A ${width}x${height} render is over the ${MAX_RENDER_PIXELS} pixel limit`,
			{
				path,
				hint: "Lower the scale or render a smaller sprite",
			},
		);
	}
}

export function renderPngs(
	sprite: Sprite,
	option: { scale: number; grid: boolean },
	frames: number[],
	pathPrefix: string,
	highlight?: Mask,
): RenderedFrame[] {
	checkRenderable(sprite, option, frames, pathPrefix);
	return frames.map((frame) => {
		const composited = renderFrame(sprite, frame);
		const image = upscale(
			highlight ? highlightMask(composited, highlight) : composited,
			option.scale,
			option.grid,
		);
		return { frame, png: encodePng(image, deflateSync) };
	});
}
