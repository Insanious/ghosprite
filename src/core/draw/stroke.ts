// Reimplemented from behaviour observed in Aseprite, not from its tool sources.

import type { CelCanvas } from "../cel-edit.ts";
import { createImage, type Rect, type Rgba } from "../image.ts";
import {
	algoEllipse,
	algoEllipsefill,
	algoLineContinuous,
	algoLineContinuousWithFixForLineBrush,
	algoSpline,
} from "./algo.ts";
import type { Brush } from "./brush.ts";
import { floodfill } from "./floodfill.ts";
import { applyInk, type InkName, type Surroundings } from "./ink.ts";
import { fillPolygon, type Point } from "./polygon.ts";
import { createRandom } from "./random.ts";
import { clipSpan, type Mask, wrap } from "./spans.ts";
import { type Symmetry, symmetryCopies } from "./symmetry.ts";

export type Shape =
	| { kind: "line"; points: readonly Point[]; pixelPerfect: boolean }
	| { kind: "rect"; rect: Rect; filled: boolean }
	| { kind: "ellipse"; rect: Rect; filled: boolean }
	| { kind: "bezier"; points: readonly Point[] }
	| { kind: "polygon"; points: readonly Point[] }
	| {
			kind: "fill";
			point: Point;
			contiguous: boolean;
			/** 0 to 255. */
			tolerance: number;
	  }
	| { kind: "dots"; points: readonly Point[] };

/** Resolved into a `dots` shape before symmetry, so every mirrored copy shares the same scatter. */
export type SprayShape = {
	kind: "spray";
	points: readonly Point[];
	radius: number;
	count: number;
};

export type StrokeOptions = {
	color: Rgba;
	ink: InkName;
	/** 0 to 255. */
	opacity: number;
	brush: Brush;
	tiled?: "x" | "y" | "both";
	mask?: Mask;
	symmetry?: Symmetry;
	/** Seeds the jumble ink. */
	seed?: number;
};

// Zero counts as positive: Aseprite's output at angle 0, where sin is exactly 0, shows it.
const sign = (value: number) => (value >= 0 ? 1 : -1);

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
	const p = sign(x2 - x1);
	const q = sign(y1 - y2);
	const r = sign(Math.cos(angle));
	const s = sign(Math.sin(angle));
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
	return angle === undefined || brush.width <= 1 || angle % 90 === 0;
}

function scatter(spray: SprayShape, random: () => number): Shape {
	const points: Point[] = [];
	for (const center of spray.points) {
		for (let i = 0; i < spray.count; i++) {
			const distance = spray.radius * Math.sqrt(random());
			const angle = 2 * Math.PI * random();
			points.push({
				x: center.x + Math.round(distance * Math.cos(angle)),
				y: center.y + Math.round(distance * Math.sin(angle)),
			});
		}
	}
	return { kind: "dots", points };
}

export function drawShape(
	target: CelCanvas,
	canvas: { width: number; height: number },
	requested: Shape | SprayShape,
	options: StrokeOptions,
): void {
	const { image } = target;
	const before = image.data.slice();
	const { color, ink, opacity, tiled, mask } = options;
	const clip = { canvas, tiled, mask };
	const random = createRandom(options.seed ?? 0);

	const snapshotAt = (x: number, y: number): Rgba => {
		const cx = Math.min(Math.max(x, 0), canvas.width - 1);
		const cy = Math.min(Math.max(y, 0), canvas.height - 1);
		const i = ((cy - target.y) * image.width + cx - target.x) * 4;
		return {
			r: before[i],
			g: before[i + 1],
			b: before[i + 2],
			a: before[i + 3],
		};
	};

	const paint = (x1: number, y: number, x2: number, source: Rgba) => {
		for (let x = x1; x <= x2; x++) {
			const offset = ((y - target.y) * image.width + x - target.x) * 4;
			const backdrop = {
				r: before[offset],
				g: before[offset + 1],
				b: before[offset + 2],
				a: before[offset + 3],
			};
			const around: Surroundings = {
				pixelAt: (dx, dy) => snapshotAt(x + dx, y + dy),
				random,
			};
			const out = applyInk(ink, backdrop, source, opacity, around);
			image.data[offset] = out.r;
			image.data[offset + 1] = out.g;
			image.data[offset + 2] = out.b;
			image.data[offset + 3] = out.a;
		}
	};

	const drawCopy = (shape: Shape, brush: Brush) => {
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
					while (col < brush.width && brush.mask[row * brush.width + col])
						col++;
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
			case "fill": {
				const flooded = createImage(canvas.width, canvas.height, "rgba");
				for (let row = 0; row < canvas.height; row++) {
					const from = ((row - target.y) * image.width - target.x) * 4;
					flooded.data.set(
						before.subarray(from, from + canvas.width * 4),
						row * canvas.width * 4,
					);
				}
				// A mirrored seed can leave the canvas: Aseprite wraps it in tiled mode and clamps it otherwise.
				const seedAxis = (value: number, size: number, tiledAxis: boolean) =>
					tiledAxis
						? wrap(value, size)
						: Math.min(Math.max(value, 0), size - 1);
				const point = {
					x: seedAxis(
						shape.point.x,
						canvas.width,
						tiled !== undefined && tiled !== "y",
					),
					y: seedAxis(
						shape.point.y,
						canvas.height,
						tiled !== undefined && tiled !== "x",
					),
				};
				const at = (point.y * canvas.width + point.x) * 4;
				const seed = {
					r: flooded.data[at],
					g: flooded.data[at + 1],
					b: flooded.data[at + 2],
					a: flooded.data[at + 3],
				};
				floodfill(
					flooded,
					mask,
					point.x,
					point.y,
					{ x: 0, y: 0, width: canvas.width, height: canvas.height },
					seed,
					shape.tolerance,
					shape.contiguous,
					false,
					(x1, y, x2) =>
						clipSpan(x1, y, x2, clip, (a, row, b) => paint(a, row, b, color)),
				);
				break;
			}
			case "dots":
				for (const dot of shape.points) stamp(dot.x, dot.y);
				break;
		}
	};

	const shape =
		requested.kind === "spray" ? scatter(requested, random) : requested;
	for (const copy of symmetryCopies(shape, options.brush, options.symmetry))
		drawCopy(copy.shape, copy.brush);
}
