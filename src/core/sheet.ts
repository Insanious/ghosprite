import { contentBounds, cropImage, pixelAt } from "./crop.ts";
import { createImage, type Image, type Rect, unionRects } from "./image.ts";
import { renderFrame } from "./render.ts";
import { findBackground, isLayerVisible, type Sprite } from "./sprite.ts";

export type SheetType = "horizontal" | "vertical" | "rows" | "columns";

export type SheetLayoutOptions = {
	type: SheetType;
	/** Frames per row, for `rows`. */
	columns?: number;
	/** Frames per column, for `columns`. */
	rows?: number;
	tag?: string;
	trim: boolean;
	trimSprite: boolean;
	ignoreEmpty: boolean;
	extrude: boolean;
	borderPadding: number;
	shapePadding: number;
	innerPadding: number;
};

export const DEFAULT_SHEET_LAYOUT: SheetLayoutOptions = {
	type: "rows",
	trim: false,
	trimSprite: false,
	ignoreEmpty: false,
	extrude: false,
	borderPadding: 0,
	shapePadding: 0,
	innerPadding: 0,
};

export type SheetEntry = {
	frame: number;
	/** The frame in the texture with its inner padding, without the extruded edge. */
	rect: Rect;
	/** Where that content sits in the source frame. */
	sourceRect: Rect;
	sourceSize: { width: number; height: number };
	duration: number;
};

export type Sheet = { texture: Image; entries: SheetEntry[] };

type Cell = { frame: number; sourceRect: Rect; image: Image };

const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function exportedFrames(sprite: Sprite, tagName: string | undefined): number[] {
	let from = 0;
	let to = sprite.frameDurations.length - 1;
	if (tagName !== undefined) {
		const tag = sprite.tags.find((t) => t.name === tagName);
		if (!tag) throw new Error(`No tag named "${tagName}"`);
		from = tag.from;
		to = tag.to;
	}
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function blit(source: Image, target: Image, x: number, y: number): void {
	for (let row = 0; row < source.height; row++) {
		const from = row * source.width * 4;
		target.data.set(
			source.data.subarray(from, from + source.width * 4),
			((y + row) * target.width + x) * 4,
		);
	}
}

/** Repeats the outermost pixels of `image` into a one pixel border. */
function extrude(image: Image): Image {
	const result = createImage(image.width + 2, image.height + 2, "rgba");
	for (let y = 0; y < result.height; y++) {
		const sy = Math.min(Math.max(y - 1, 0), image.height - 1);
		for (let x = 0; x < result.width; x++) {
			const sx = Math.min(Math.max(x - 1, 0), image.width - 1);
			const from = (sy * image.width + sx) * 4;
			result.data.set(
				image.data.subarray(from, from + 4),
				(y * result.width + x) * 4,
			);
		}
	}
	return result;
}

/** Splits the cells into rows, or into columns for the column layouts. */
function groupIntoLines(cells: Cell[], options: SheetLayoutOptions): Cell[][] {
	const perLine = {
		horizontal: cells.length,
		vertical: cells.length,
		rows: options.columns ?? cells.length,
		columns: options.rows ?? cells.length,
	}[options.type];
	const lines: Cell[][] = [];
	for (let i = 0; i < cells.length; i += perLine) {
		lines.push(cells.slice(i, i + perLine));
	}
	return lines;
}

/**
 * Renders the exported frames and lays them out in a texture. Cells follow
 * each other along their row (or column, for the column layouts), and a line
 * is as tall (wide) as its largest cell.
 */
export function layoutSheet(
	sprite: Sprite,
	options: SheetLayoutOptions,
): Sheet {
	const frames = exportedFrames(sprite, options.tag);
	const background = findBackground(sprite);
	const hasBackground = !!background && isLayerVisible(sprite, background);
	const sourceSize = { width: sprite.width, height: sprite.height };
	const full: Rect = { x: 0, y: 0, width: sprite.width, height: sprite.height };

	const renders = frames.map((frame) => {
		const image = renderFrame(sprite, frame);
		const reference = hasBackground ? pixelAt(image, 0, 0) : 0;
		return { frame, image, bounds: contentBounds(image, reference) };
	});

	let spriteBounds: Rect | undefined;
	if (options.trimSprite) {
		const union = renders.reduce<Rect>(
			(acc, r) => (r.bounds ? unionRects(acc, r.bounds) : acc),
			{ x: 0, y: 0, width: 0, height: 0 },
		);
		spriteBounds =
			union.width > 0 ? union : { x: 0, y: 0, width: 1, height: 1 };
	}

	const inner = options.innerPadding;
	const extrusion = options.extrude ? 1 : 0;
	const cells: Cell[] = [];
	for (const { frame, image, bounds } of renders) {
		if (options.ignoreEmpty && !bounds) continue;
		let sourceRect = spriteBounds ?? full;
		if (options.trim)
			sourceRect = bounds ?? { x: 0, y: 0, width: 1, height: 1 };
		const content = cropImage(image, sourceRect, TRANSPARENT);
		const extruded = options.extrude ? extrude(content) : content;
		const cellImage = cropImage(
			extruded,
			{
				x: -inner,
				y: -inner,
				width: extruded.width + 2 * inner,
				height: extruded.height + 2 * inner,
			},
			TRANSPARENT,
		);
		cells.push({ frame, sourceRect, image: cellImage });
	}

	const alongWidth = options.type === "horizontal" || options.type === "rows";
	const border = options.borderPadding;
	const gap = options.shapePadding;
	const placed: { cell: Cell; x: number; y: number }[] = [];
	let lineStart = border;
	for (const line of groupIntoLines(cells, options)) {
		let along = border;
		let lineSize = 0;
		for (const cell of line) {
			const { width, height } = cell.image;
			placed.push(
				alongWidth
					? { cell, x: along, y: lineStart }
					: { cell, x: lineStart, y: along },
			);
			along += (alongWidth ? width : height) + gap;
			lineSize = Math.max(lineSize, alongWidth ? height : width);
		}
		lineStart += lineSize + gap;
	}

	const extent = (axis: "x" | "y") =>
		placed.reduce(
			(max, { cell, x, y }) =>
				Math.max(
					max,
					axis === "x" ? x + cell.image.width : y + cell.image.height,
				),
			0,
		);
	const texture = createImage(
		extent("x") + border,
		extent("y") + border,
		"rgba",
	);
	const entries = placed.map(({ cell, x, y }) => {
		blit(cell.image, texture, x, y);
		return {
			frame: cell.frame,
			rect: {
				x: x + extrusion,
				y: y + extrusion,
				width: cell.sourceRect.width + 2 * inner,
				height: cell.sourceRect.height + 2 * inner,
			},
			sourceRect: cell.sourceRect,
			sourceSize,
			duration: sprite.frameDurations[cell.frame] ?? 0,
		};
	});
	return { texture, entries };
}
