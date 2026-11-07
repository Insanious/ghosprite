import { deflateSync } from "node:zlib";
import { z } from "zod";
import { encodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import type { Sprite } from "../core/sprite.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";

export const renderOptionFields = {
	scale: z.number().int().min(1).max(64).default(1),
	grid: z.boolean().default(false),
	frames: z.array(z.number().int().min(0)).optional(),
};

const GRID_MIN_SCALE = 4;

export function withGridRule<
	T extends z.ZodType<{ scale: number; grid: boolean }>,
>(schema: T) {
	return schema.refine((o) => !o.grid || o.scale >= GRID_MIN_SCALE, {
		path: ["grid"],
		message: `grid needs scale ${GRID_MIN_SCALE} or more`,
	});
}

export const renderOptionSchema = withGridRule(z.object(renderOptionFields));

export type RenderOption = z.infer<typeof renderOptionSchema>;

export type RenderedFrame = { frame: number; png: Uint8Array };

export function renderPngs(
	sprite: Sprite,
	option: { scale: number; grid: boolean },
	frames: number[],
	framesPath: string,
): RenderedFrame[] {
	const frameCount = sprite.frameDurations.length;
	return frames.map((frame) => {
		if (frame >= frameCount) {
			throw new OpError(
				"out_of_range",
				`Frame ${frame} is out of range, the sprite has ${frameCount} frames`,
				{ path: framesPath },
			);
		}
		const image = upscale(
			renderFrame(sprite, frame),
			option.scale,
			option.grid,
		);
		return { frame, png: encodePng(image, deflateSync) };
	});
}
