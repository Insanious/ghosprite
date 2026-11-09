import { deflateSync } from "node:zlib";
import { z } from "zod";
import { withBackground } from "../core/background.ts";
import type { Mask } from "../core/draw/spans.ts";
import type { Image } from "../core/image.ts";
import type { Palette } from "../core/palette.ts";
import { encodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import { highlightMask } from "../core/selection.ts";
import type { Sprite } from "../core/sprite.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";
import { checkFrames } from "../target.ts";
import { literalColorSchema, toRgba } from "./color.ts";

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

const CHECKER_MIN_SQUARE_PIXELS = 8;
const NO_PALETTE: Palette = { startFrame: 0, colors: [] };

export function withRenderBackground(
	image: Image,
	background: RenderBackground | undefined,
	scale: number,
): Image {
	if (background === undefined) return image;
	if (background === "checker") {
		return withBackground(image, {
			kind: "checker",
			square: Math.ceil(CHECKER_MIN_SQUARE_PIXELS / scale),
		});
	}
	return withBackground(image, {
		kind: "color",
		color: toRgba(background, "background", NO_PALETTE),
	});
}

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
	checkFrames(sprite, frames, `${pathPrefix}frames`);
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
	option: { scale: number; grid: boolean; background?: RenderBackground },
	frames: number[],
	pathPrefix: string,
	highlight?: Mask,
): RenderedFrame[] {
	checkRenderable(sprite, option, frames, pathPrefix);
	return frames.map((frame) => {
		const composited = withRenderBackground(
			renderFrame(sprite, frame),
			option.background,
			option.scale,
		);
		const image = upscale(
			highlight ? highlightMask(composited, highlight) : composited,
			option.scale,
			option.grid,
		);
		return { frame, png: encodePng(image, deflateSync) };
	});
}
