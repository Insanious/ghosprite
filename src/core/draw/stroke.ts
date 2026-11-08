// Reimplemented from behaviour observed in Aseprite, not from its tool sources.

import type { CelCanvas } from "../cel-edit.ts";
import type { Rect, Rgba } from "../image.ts";
import {
	algoEllipse,
	algoEllipsefill,
	algoLineContinuous,
	algoLineContinuousWithFixForLineBrush,
	algoSpline,
} from "./algo.ts";
import type { Brush } from "./brush.ts";
import { applyInk, type InkName } from "./ink.ts";
import { fillPolygon, type Point } from "./polygon.ts";
import { clipSpan, type Mask } from "./spans.ts";

export type Shape =
	| { kind: "line"; points: readonly Point[]; pixelPerfect: boolean }
	| { kind: "rect"; rect: Rect; filled: boolean }
	| { kind: "ellipse"; rect: Rect; filled: boolean }
	| { kind: "bezier"; points: readonly Point[] }
	| { kind: "polygon"; points: readonly Point[] };

export type StrokeOptions = {
	color: Rgba;
	ink: InkName;
	/** 0 to 255. */
	opacity: number;
	brush: Brush;
	tiled?: "x" | "y" | "both";
	mask?: Mask;
};

function segmentAlgorithm(
	brush: Brush,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
) {
	if (brush.lineAngle === undefined || brush.width <= 1)
		return algoLineContinuous;
	const angle = (Math.PI * brush.lineAngle) / 180;
	const p = Math.sign(x2 - x1);
	const q = Math.sign(y1 - y2);
	const r = Math.sign(Math.cos(angle));
	const s = Math.sign(Math.sin(angle));
	return (p === q) !== (r === s)
		? algoLineContinuousWithFixForLineBrush
		: algoLineContinuous;
}

function isOrthogonal(a: Point, b: Point): boolean {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function isDiagonal(a: Point, b: Point): boolean {
	return Math.abs(a.x - b.x) === 1 && Math.abs(a.y - b.y) === 1;
}

function dropLCorners(pixels: readonly Point[]): Point[] {
	const kept: Point[] = [];
	for (let i = 0; i < pixels.length; i++) {
		const previous = kept[kept.length - 1];
		const next = pixels[i + 1];
		const current = pixels[i];
		const isCorner =
			previous &&
			next &&
			isOrthogonal(previous, current) &&
			isOrthogonal(current, next) &&
			isDiagonal(previous, next);
		if (!isCorner) kept.push(current);
	}
	return kept;
}

function linePixels(points: readonly Point[], brush: Brush): Point[] {
	const pixels: Point[] = [];
	const add = (x: number, y: number) => {
		const last = pixels[pixels.length - 1];
		if (!last || last.x !== x || last.y !== y) pixels.push({ x, y });
	};
	if (points.length === 1) add(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		segmentAlgorithm(brush, a.x, a.y, b.x, b.y)(a.x, a.y, b.x, b.y, add);
	}
	return pixels;
}

function dropsLCorners(brush: Brush): boolean {
	const angle = brush.lineAngle;
	return (
		angle === undefined || brush.width <= 1 || [0, 90, 180].includes(angle)
	);
}

export function drawShape(
	target: CelCanvas,
	canvas: { width: number; height: number },
	shape: Shape,
	options: StrokeOptions,
): void {
	const { image } = target;
	const before = image.data.slice();
	const { color, ink, opacity, brush, tiled, mask } = options;
	const clip = { canvas, tiled, mask };

	const paint = (x1: number, y: number, x2: number, source: Rgba) => {
		for (let x = x1; x <= x2; x++) {
			const offset = ((y - target.y) * image.width + x - target.x) * 4;
			const backdrop = {
				r: before[offset],
				g: before[offset + 1],
				b: before[offset + 2],
				a: before[offset + 3],
			};
			const out = applyInk(ink, backdrop, source, opacity);
			image.data[offset] = out.r;
			image.data[offset + 1] = out.g;
			image.data[offset + 2] = out.b;
			image.data[offset + 3] = out.a;
		}
	};

	const stamp = (px: number, py: number) => {
		const left = px - brush.center.x;
		const top = py - brush.center.y;
		for (let row = 0; row < brush.height; row++) {
			let col = 0;
			while (col < brush.width) {
				if (!brush.mask[row * brush.width + col]) {
					col++;
					continue;
				}
				if (brush.image) {
					const i = (row * brush.width + col) * 4;
					const source = {
						r: brush.image.data[i],
						g: brush.image.data[i + 1],
						b: brush.image.data[i + 2],
						a: brush.image.data[i + 3],
					};
					clipSpan(left + col, top + row, left + col, clip, (x1, y, x2) =>
						paint(x1, y, x2, source),
					);
					col++;
					continue;
				}
				const start = col;
				while (col < brush.width && brush.mask[row * brush.width + col]) col++;
				clipSpan(left + start, top + row, left + col - 1, clip, (x1, y, x2) =>
					paint(x1, y, x2, color),
				);
			}
		}
	};

	const stampSpan = (x1: number, y: number, x2: number) => {
		for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) stamp(x, y);
	};

	const stampLine = (a: Point, b: Point) =>
		segmentAlgorithm(brush, a.x, a.y, b.x, b.y)(a.x, a.y, b.x, b.y, stamp);

	switch (shape.kind) {
		case "line": {
			if (shape.pixelPerfect) {
				const pixels = linePixels(shape.points, brush);
				const kept = dropsLCorners(brush) ? dropLCorners(pixels) : pixels;
				for (const pixel of kept) stamp(pixel.x, pixel.y);
			} else if (shape.points.length === 1) {
				stamp(shape.points[0].x, shape.points[0].y);
			} else {
				for (let i = 1; i < shape.points.length; i++)
					stampLine(shape.points[i - 1], shape.points[i]);
			}
			break;
		}
		case "rect": {
			const { x, y, width, height } = shape.rect;
			const right = x + width - 1;
			const bottom = y + height - 1;
			if (shape.filled) {
				for (let row = y; row <= bottom; row++) stampSpan(x, row, right);
			} else {
				stampLine({ x, y }, { x: right, y });
				stampLine({ x, y: bottom }, { x: right, y: bottom });
				for (let row = y; row <= bottom; row++) {
					stamp(x, row);
					stamp(right, row);
				}
			}
			break;
		}
		case "ellipse": {
			const { x, y, width, height } = shape.rect;
			if (shape.filled)
				algoEllipsefill(x, y, x + width - 1, y + height - 1, 0, 0, stampSpan);
			else algoEllipse(x, y, x + width - 1, y + height - 1, 0, 0, stamp);
			break;
		}
		case "bezier": {
			const [p0, p1, p2, p3] = shape.points;
			algoSpline(
				p0.x,
				p0.y,
				p1.x,
				p1.y,
				p2.x,
				p2.y,
				p3.x,
				p3.y,
				(ax, ay, bx, by) => stampLine({ x: ax, y: ay }, { x: bx, y: by }),
			);
			break;
		}
		case "polygon":
			fillPolygon(shape.points, stampSpan);
			break;
	}
}
