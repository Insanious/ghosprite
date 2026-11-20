import { type Image, renderFrame } from "../../src/core/index.ts";
import {
	type Check,
	type EvalDefinition,
	onSpriteOfSize,
	opaqueColors,
	opaqueCoverage,
} from "../../src/eval/checks.ts";

const WIDTH = 24;
const HEIGHT = 24;
const OUTLINE = "#222034";
const OUTLINE_RGB = [0x22, 0x20, 0x34];
const MIN_BOTTLE_COVERAGE = 0.15;
const MIN_FILL_COLORS = 3;
const MIN_CLOSED = 0.95;
const MAX_DOUBLED = 0.15;

const NEIGHBOURS = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
] as const;

function alphaAt(image: Image, x: number, y: number): number {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return 0;
	return image.data[(y * image.width + x) * 4 + 3] as number;
}

function isOutline(image: Image, x: number, y: number): boolean {
	const i = (y * image.width + x) * 4;
	return (
		image.data[i + 3] === 255 &&
		OUTLINE_RGB.every((value, c) => image.data[i + c] === value)
	);
}

function isEdge(image: Image, x: number, y: number): boolean {
	return (
		alphaAt(image, x, y) > 0 &&
		NEIGHBOURS.some(([dx, dy]) => alphaAt(image, x + dx, y + dy) === 0)
	);
}

type Pixel = { x: number; y: number };

function pixelsWhere(image: Image, test: (x: number, y: number) => boolean) {
	const found: Pixel[] = [];
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			if (test(x, y)) found.push({ x, y });
		}
	}
	return found;
}

function percent(fraction: number): string {
	return `${(fraction * 100).toFixed(1)}%`;
}

const bottle: Check = {
	name: "bottle",
	part: "bottle",
	run: onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const image = renderFrame(sprite, 0);
		const coverage = opaqueCoverage(image);
		const fills = [...opaqueColors(image).keys()].filter(
			(color) => color !== OUTLINE,
		).length;
		const detail = `${percent(coverage)} of the canvas is opaque, ${fills} opaque colours besides ${OUTLINE}`;
		return {
			pass: coverage >= MIN_BOTTLE_COVERAGE && fills >= MIN_FILL_COLORS,
			detail: `${detail}, needs at least ${MIN_BOTTLE_COVERAGE * 100}% and ${MIN_FILL_COLORS} colours`,
		};
	}),
};

const outlineClosed: Check = {
	name: "outline closed",
	part: "outline",
	run: onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const image = renderFrame(sprite, 0);
		const edge = pixelsWhere(image, (x, y) => isEdge(image, x, y));
		if (edge.length === 0)
			return { pass: false, detail: "the sprite is empty" };
		const outlined = edge.filter(({ x, y }) => isOutline(image, x, y)).length;
		const share = outlined / edge.length;
		return {
			pass: share >= MIN_CLOSED,
			detail: `${percent(share)} of ${edge.length} edge pixels are ${OUTLINE}, needs at least ${MIN_CLOSED * 100}%`,
		};
	}),
};

const outlineOnePixel: Check = {
	name: "outline one pixel",
	part: "outline",
	run: onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const image = renderFrame(sprite, 0);
		const inner = pixelsWhere(
			image,
			(x, y) =>
				alphaAt(image, x, y) > 0 &&
				!isEdge(image, x, y) &&
				NEIGHBOURS.some(([dx, dy]) => isEdge(image, x + dx, y + dy)),
		);
		const doubled = inner.filter(({ x, y }) => isOutline(image, x, y)).length;
		const share = inner.length === 0 ? 0 : doubled / inner.length;
		return {
			pass: share <= MAX_DOUBLED,
			detail: `${percent(share)} of ${inner.length} pixels just inside the edge are ${OUTLINE}, allows at most ${MAX_DOUBLED * 100}%`,
		};
	}),
};

const definition: EvalDefinition = {
	parts: ["bottle", "outline"],
	checks: [bottle, outlineClosed, outlineOnePixel],
};

export default definition;
