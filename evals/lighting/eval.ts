import type { Image } from "../../src/core/index.ts";
import {
	alphaBounds,
	type Check,
	type EvalDefinition,
	findShadowLayer,
	luma,
	onSpriteOfSize,
	opaqueCoverage,
	renderWithout,
	shadowDirectionCheck,
	shadowLayerCheck,
} from "../../src/eval/checks.ts";

const SIZE = 32;
const MIN_BALL_COVERAGE = 0.1;
const MIN_HIGHLIGHT_RATIO = 1.3;

type OpaquePixel = { x: number; y: number; luma: number };

function opaquePixels(image: Image): OpaquePixel[] {
	const pixels: OpaquePixel[] = [];
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const i = (y * image.width + x) * 4;
			if (image.data[i + 3] !== 255) continue;
			const r = image.data[i] as number;
			const g = image.data[i + 1] as number;
			const b = image.data[i + 2] as number;
			pixels.push({ x, y, luma: luma(r, g, b) });
		}
	}
	return pixels;
}

const ball: Check = {
	name: "ball",
	part: "ball",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const coverage = opaqueCoverage(
			renderWithout(sprite, findShadowLayer(sprite)),
		);
		const percent = (coverage * 100).toFixed(1);
		return coverage >= MIN_BALL_COVERAGE
			? { pass: true, detail: `${percent}% of the canvas is opaque` }
			: {
					pass: false,
					detail: `${percent}% of the canvas is opaque, needs at least ${MIN_BALL_COVERAGE * 100}%`,
				};
	}),
};

const lightDirection: Check = {
	name: "light direction",
	part: "light and dark sides",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const pixels = opaquePixels(renderWithout(sprite, findShadowLayer(sprite)));
		const totalLuma = pixels.reduce((sum, pixel) => sum + pixel.luma, 0);
		if (pixels.length === 0 || totalLuma === 0) {
			return { pass: false, detail: "the ball has no lit opaque pixels" };
		}
		const meanX = pixels.reduce((sum, p) => sum + p.x, 0) / pixels.length;
		const meanY = pixels.reduce((sum, p) => sum + p.y, 0) / pixels.length;
		const litX = pixels.reduce((sum, p) => sum + p.x * p.luma, 0) / totalLuma;
		const litY = pixels.reduce((sum, p) => sum + p.y * p.luma, 0) / totalLuma;
		const dx = litX - meanX;
		const dy = litY - meanY;
		return {
			pass: dx < 0 && dy < 0,
			detail: `the luma-weighted centroid is ${dx.toFixed(2)} right and ${dy.toFixed(2)} below the plain centroid, and needs to be left and above`,
		};
	}),
};

const highlight: Check = {
	name: "highlight",
	part: "highlight",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const image = renderWithout(sprite, findShadowLayer(sprite));
		const bounds = alphaBounds(image);
		const pixels = opaquePixels(image);
		if (!bounds || pixels.length === 0) {
			return { pass: false, detail: "the ball has no opaque pixels" };
		}
		const lumas = pixels.map((pixel) => pixel.luma).sort((a, b) => a - b);
		const median = lumas[Math.floor(lumas.length / 2)] as number;
		const top = Math.max(...lumas);
		const lightest = pixels.filter((pixel) => pixel.luma === top);
		const x = lightest.reduce((sum, p) => sum + p.x, 0) / lightest.length;
		const y = lightest.reduce((sum, p) => sum + p.y, 0) / lightest.length;
		const upperLeft =
			x < bounds.x + bounds.width / 2 && y < bounds.y + bounds.height / 2;
		const ratio = median === 0 ? Number.POSITIVE_INFINITY : top / median;
		const detail = `the lightest colour is at (${x.toFixed(1)}, ${y.toFixed(1)}) in a ball spanning ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}, ${ratio.toFixed(2)} times the median luma, and needs the upper-left quadrant and at least ${MIN_HIGHLIGHT_RATIO} times`;
		return { pass: upperLeft && ratio >= MIN_HIGHLIGHT_RATIO, detail };
	}),
};

const definition: EvalDefinition = {
	parts: ["ball", "light and dark sides", "highlight", "cast shadow"],
	checks: [
		ball,
		lightDirection,
		highlight,
		shadowLayerCheck(SIZE, SIZE, "cast shadow"),
		shadowDirectionCheck(SIZE, SIZE, "cast shadow"),
	],
};

export default definition;
