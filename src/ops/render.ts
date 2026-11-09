import { z } from "zod";
import type { Mask } from "../core/draw/spans.ts";
import { renderFrame } from "../core/render.ts";
import type { Sprite } from "../core/sprite.ts";
import { checkFrames } from "../target.ts";
import { literalColorSchema } from "./color.ts";
import { renderPng } from "./render-output.ts";

const backgroundSchema = z.union([
	z.literal("checker"),
	...literalColorSchema.options,
]);

export type RenderBackground = z.infer<typeof backgroundSchema>;

export const renderOptionFields = {
	scale: z.number().int().min(1).max(64).default(1),
	grid: z.boolean().default(false),
	frames: z.array(z.number().int().min(0)).optional(),
	background: backgroundSchema
		.optional()
		.describe(
			'Draw the picture over a colour (#rrggbb, #rrggbbaa or {r, g, b, a}) or a grey checkerboard ("checker") to judge semi-transparent pixels. The sprite is unchanged. Defaults to transparent.',
		),
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

export const selectionIdField = z
	.string()
	.optional()
	.describe("Highlight this selection on the render");

export const renderOptionSchema = withGridRule(
	z.object({ ...renderOptionFields, selectionId: selectionIdField }),
);

export type RenderOption = z.infer<typeof renderOptionSchema>;

export type RenderedFrame = { frame: number; png: Uint8Array };

export function renderPngs(
	sprite: Sprite,
	option: { scale: number; grid: boolean; background?: RenderBackground },
	frames: number[],
	pathPrefix: string,
	highlight?: Mask,
): RenderedFrame[] {
	checkFrames(sprite, frames, `${pathPrefix}frames`);
	return frames.map((frame) => ({
		frame,
		png: renderPng(
			[renderFrame(sprite, frame)],
			option,
			{ columns: 1, gap: 0 },
			`${pathPrefix}scale`,
			highlight,
		).png,
	}));
}
