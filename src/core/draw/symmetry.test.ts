import { describe, expect, test } from "bun:test";
import { createBrush } from "./brush.ts";
import type { Shape } from "./stroke.ts";
import { symmetryCopies } from "./symmetry.ts";

const line = (x: number, y: number): Shape => ({
	kind: "line",
	points: [{ x, y }],
	pixelPerfect: false,
});

function mirroredPoints(size: number, symmetry: { x?: number; y?: number }) {
	const brush = createBrush({ type: "circle", size, angle: 0 });
	return symmetryCopies(line(1, 2), brush, symmetry).map(
		(copy) =>
			(copy.shape as { points: readonly { x: number; y: number }[] }).points[0],
	);
}

describe("symmetryCopies", () => {
	test("a 1-px brush maps x to 2a - 1 - x", () => {
		expect(mirroredPoints(1, { x: 8 })[1]).toEqual({ x: 14, y: 2 });
	});

	test("an even brush maps x to 2a - x", () => {
		expect(mirroredPoints(4, { x: 8 })[1]).toEqual({ x: 15, y: 2 });
	});

	test("both gives the original and three mirrors", () => {
		expect(mirroredPoints(1, { x: 8, y: 8 })).toEqual([
			{ x: 1, y: 2 },
			{ x: 14, y: 2 },
			{ x: 1, y: 13 },
			{ x: 14, y: 13 },
		]);
	});

	test("a line brush at 45 degrees mirrors to 135", () => {
		const brush = createBrush({ type: "line", size: 5, angle: 45 });
		const [, mirrored] = symmetryCopies(line(1, 1), brush, { x: 8 });
		expect(mirrored.brush.lineAngle).toBe(135);
	});
});
