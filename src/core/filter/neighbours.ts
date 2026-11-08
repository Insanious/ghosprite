import type { Tiled } from "../draw/spans.ts";
import type { Image, Rect } from "../image.ts";
import { edgeCoordinate } from "./filter.ts";

/**
 * Byte offsets in `src` of the `width` x `height` window whose element (centerX, centerY) sits on
 * (x, y), in row-major order. The window is moved inside `canvas` by wrapping on tiled axes and
 * clamping to the edge otherwise.
 */
export function neighbourOffsets(
	src: Image,
	canvas: Rect,
	tiled: Tiled | undefined,
	x: number,
	y: number,
	window: { width: number; height: number; centerX: number; centerY: number },
): number[] {
	const columns = edgeColumns(
		x - window.centerX - canvas.x,
		window.width,
		canvas.width,
		tiled === "x" || tiled === "both",
	);
	const offsets: number[] = [];
	for (let dy = 0; dy < window.height; dy++) {
		const row = edgeCoordinate(
			y - window.centerY + dy - canvas.y,
			canvas.height,
			tiled === "y" || tiled === "both",
		);
		for (const column of columns) {
			offsets.push(((canvas.y + row) * src.width + canvas.x + column) * 4);
		}
	}
	return offsets;
}

/**
 * Aseprite walks a row of the window with a position that advances while the pixel read lags
 * behind it when the window starts left of the canvas. If the window is wider than the canvas
 * allows, the reads stop short of the right edge and repeat an earlier pixel. This reproduces that.
 */
function edgeColumns(
	start: number,
	count: number,
	size: number,
	wrap: boolean,
): number[] {
	const columns: number[] = [];
	if (wrap || start >= 0) {
		for (let i = 0; i < count; i++)
			columns.push(edgeCoordinate(start + i, size, wrap));
		return columns;
	}
	let position = 0;
	let read = 0;
	let lag = -start;
	for (let i = 0; i < count; i++) {
		columns.push(read);
		if (position >= size - 1) continue;
		position++;
		if (lag === 0) read++;
		else lag--;
	}
	return columns;
}
