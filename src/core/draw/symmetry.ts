// Reimplemented from behaviour observed in Aseprite, not from its tool sources.
// The brush flip follows Brush::getSymmetryImage in src/doc/brush.cpp (MIT).

import type { Image } from "../image.ts";
import type { Brush } from "./brush.ts";
import type { Point } from "./polygon.ts";
import type { Shape } from "./stroke.ts";

/** Axes are sprite-space positions in multiples of 0.5; an absent axis does not mirror. */
export type Symmetry = { x?: number; y?: number };

function flipBytes(
	data: Uint8Array,
	width: number,
	height: number,
	bytesPerPixel: number,
	horizontal: boolean,
	vertical: boolean,
): Uint8Array {
	const out = new Uint8Array(data.length);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const sx = horizontal ? width - 1 - x : x;
			const sy = vertical ? height - 1 - y : y;
			const from = (sy * width + sx) * bytesPerPixel;
			out.set(
				data.subarray(from, from + bytesPerPixel),
				(y * width + x) * bytesPerPixel,
			);
		}
	}
	return out;
}

function flipBrush(
	brush: Brush,
	horizontal: boolean,
	vertical: boolean,
): Brush {
	if (!horizontal && !vertical) return brush;
	const { width, height } = brush;
	const flipped: Brush = {
		...brush,
		mask: flipBytes(brush.mask, width, height, 1, horizontal, vertical),
	};
	if (flipped.lineAngle !== undefined) {
		const angle = horizontal ? 180 - flipped.lineAngle : flipped.lineAngle;
		flipped.lineAngle = vertical ? -angle : angle;
	}
	if (brush.image) {
		const image: Image = {
			...brush.image,
			data: flipBytes(brush.image.data, width, height, 4, horizontal, vertical),
		};
		flipped.image = image;
	}
	return flipped;
}

/** Mirrors a brush-centre coordinate so the brush footprint is the mirror of the original. */
function mirror(
	value: number,
	axis: number,
	size: number,
	center: number,
): number {
	return 2 * (axis + center) - value - size;
}

type Mirroring = { horizontal: boolean; vertical: boolean };

function mirroredPoint(
	point: Point,
	brush: Pick<Brush, "width" | "height" | "center">,
	symmetry: Symmetry,
	{ horizontal, vertical }: Mirroring,
): Point {
	return {
		x:
			horizontal && symmetry.x !== undefined
				? mirror(point.x, symmetry.x, brush.width, brush.center.x)
				: point.x,
		y:
			vertical && symmetry.y !== undefined
				? mirror(point.y, symmetry.y, brush.height, brush.center.y)
				: point.y,
	};
}

function mirroredBox(
	rect: { x: number; y: number; width: number; height: number },
	mirrorPoint: (point: Point) => Point,
) {
	const a = mirrorPoint({ x: rect.x, y: rect.y });
	const b = mirrorPoint({
		x: rect.x + rect.width - 1,
		y: rect.y + rect.height - 1,
	});
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x, b.x) - x + 1,
		height: Math.max(a.y, b.y) - y + 1,
	};
}

const singlePixel = { width: 1, height: 1, center: { x: 0, y: 0 } };

function mirroredShape(
	shape: Shape,
	mirrorPoint: (point: Point) => Point,
	mirrorSeed: (point: Point) => Point,
): Shape {
	switch (shape.kind) {
		case "fill":
			return { ...shape, point: mirrorSeed(shape.point) };
		case "line":
		case "bezier":
		case "polygon":
		case "dots":
			return { ...shape, points: shape.points.map(mirrorPoint) };
		case "rect":
		case "ellipse":
			return { ...shape, rect: mirroredBox(shape.rect, mirrorPoint) };
	}
}

/** The shape and every mirrored copy of it, each with the brush to draw it with. */
export function symmetryCopies(
	shape: Shape,
	brush: Brush,
	symmetry: Symmetry | undefined,
): { shape: Shape; brush: Brush }[] {
	const copies = [{ shape, brush }];
	if (!symmetry) return copies;
	const combinations: Mirroring[] = [];
	if (symmetry.x !== undefined)
		combinations.push({ horizontal: true, vertical: false });
	if (symmetry.y !== undefined)
		combinations.push({ horizontal: false, vertical: true });
	if (symmetry.x !== undefined && symmetry.y !== undefined)
		combinations.push({ horizontal: true, vertical: true });
	for (const mirroring of combinations) {
		copies.push({
			shape: mirroredShape(
				shape,
				(point) => mirroredPoint(point, brush, symmetry, mirroring),
				(point) => mirroredPoint(point, singlePixel, symmetry, mirroring),
			),
			brush: flipBrush(brush, mirroring.horizontal, mirroring.vertical),
		});
	}
	return copies;
}
