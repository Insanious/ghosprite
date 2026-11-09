import { deflateSync } from "node:zlib";
import { withBackground } from "../core/background.ts";
import { tileImages } from "../core/contact-sheet.ts";
import type { Mask } from "../core/draw/spans.ts";
import type { Image, Rect } from "../core/image.ts";
import type { Palette } from "../core/palette.ts";
import { encodePng } from "../core/png.ts";
import { highlightMask } from "../core/selection.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";
import { toRgba } from "./color.ts";
import type { RenderBackground } from "./render.ts";

const MAX_RENDER_PIXELS = 4096 * 4096;
const CHECKER_MIN_SQUARE_PIXELS = 8;
const NO_PALETTE: Palette = { startFrame: 0, colors: [] };

export type RenderView = {
	scale: number;
	grid: boolean;
	background?: RenderBackground;
};

export type RenderLayout = { columns: number; gap: number };

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

function withRenderBackground(
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

export function renderPng(
	images: Image[],
	view: RenderView,
	layout: RenderLayout,
	limitPath: string,
	highlight?: Mask,
): { png: Uint8Array; rects: Rect[] } {
	const gridPixels = view.grid ? 1 : 0;
	const cellWidth =
		Math.max(0, ...images.map((i) => i.width)) * view.scale + gridPixels;
	const cellHeight =
		Math.max(0, ...images.map((i) => i.height)) * view.scale + gridPixels;
	const rows = Math.ceil(images.length / layout.columns);
	checkPixelLimit(
		layout.columns * cellWidth + (layout.columns - 1) * layout.gap,
		rows * cellHeight + (rows - 1) * layout.gap,
		limitPath,
	);

	const cells = images.map((image) => {
		const composited = withRenderBackground(image, view.background, view.scale);
		return upscale(
			highlight ? highlightMask(composited, highlight) : composited,
			view.scale,
			view.grid,
		);
	});
	const sheet = tileImages(cells, layout.columns, layout.gap);
	return { png: encodePng(sheet.image, deflateSync), rects: sheet.rects };
}
