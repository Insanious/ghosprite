import {
	type Image,
	type Rect,
	renderFrame,
	type Sprite,
} from "../../src/core/index.ts";
import {
	alphaBounds,
	type Check,
	type CheckResult,
	type EvalDefinition,
	opaqueCoverage,
	spriteOfSize,
} from "../../src/eval/checks.ts";

const WIDTH = 16;
const HEIGHT = 24;
const FRAMES = 3;
const MIN_SYMMETRY = 0.8;
const MIN_BACK_DIFFERENCE = 0.05;
const MAX_HEIGHT_SPREAD = 1;

type View = { image: Image; bounds: Rect };
type Views = { front: View; side: View; back: View };

function isOpaque(image: Image, x: number, y: number): boolean {
	return image.data[(y * image.width + x) * 4 + 3] === 255;
}

function sameColor(
	a: Image,
	ax: number,
	b: Image,
	bx: number,
	y: number,
): boolean {
	const i = (y * a.width + ax) * 4;
	const j = (y * b.width + bx) * 4;
	return [0, 1, 2].every((c) => a.data[i + c] === b.data[j + c]);
}

function mirrorMatch(image: Image, bounds: Rect): number {
	let opaque = 0;
	let matched = 0;
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			if (!isOpaque(image, x, y)) continue;
			opaque++;
			const mirrored = 2 * bounds.x + bounds.width - 1 - x;
			if (
				mirrored >= 0 &&
				mirrored < image.width &&
				isOpaque(image, mirrored, y) &&
				sameColor(image, x, image, mirrored, y)
			) {
				matched++;
			}
		}
	}
	return matched / opaque;
}

function backDifference(front: Image, back: Image): number {
	let both = 0;
	let differ = 0;
	for (let y = 0; y < front.height; y++) {
		for (let x = 0; x < front.width; x++) {
			if (!isOpaque(front, x, y) || !isOpaque(back, x, y)) continue;
			both++;
			if (!sameColor(front, x, back, x, y)) differ++;
		}
	}
	return both === 0 ? 0 : differ / both;
}

function percent(ratio: number): string {
	return `${(ratio * 100).toFixed(1)}%`;
}

function onViews(run: (views: Views, sprite: Sprite) => CheckResult) {
	return (sprites: Sprite[]): CheckResult => {
		const sprite = spriteOfSize(sprites, WIDTH, HEIGHT);
		if (!sprite) return { pass: false, detail: `no ${WIDTH}x${HEIGHT} sprite` };
		const count = sprite.frameDurations.length;
		if (count < FRAMES) {
			return { pass: false, detail: `${count} frames, needs ${FRAMES}` };
		}
		const views = [0, 1, 2].map((frame) => {
			const image = renderFrame(sprite, frame);
			return {
				image,
				bounds: alphaBounds(image),
				opaque: opaqueCoverage(image),
			};
		});
		const empty = views.findIndex((view) => view.opaque === 0);
		if (empty >= 0) {
			return {
				pass: false,
				detail: `${count} frames, but frame ${empty} has no opaque pixel`,
			};
		}
		const [front, side, back] = views.map((view) => ({
			image: view.image,
			bounds: view.bounds as Rect,
		})) as [View, View, View];
		return run({ front, side, back }, sprite);
	};
}

const threeFrames: Check = {
	name: "three frames",
	part: "consistent proportions",
	run: onViews((_, sprite) => ({
		pass: true,
		detail: `${sprite.frameDurations.length} frames, each with an opaque pixel`,
	})),
};

const frontSymmetric: Check = {
	name: "front symmetric",
	part: "front view",
	run: onViews(({ front }) => {
		const match = mirrorMatch(front.image, front.bounds);
		return {
			pass: match >= MIN_SYMMETRY,
			detail: `${percent(match)} of frame 0 mirrors onto itself, needs at least ${percent(MIN_SYMMETRY)}`,
		};
	}),
};

const sideNarrower: Check = {
	name: "side narrower",
	part: "side view",
	run: onViews(({ front, side }) => ({
		pass: side.bounds.width < front.bounds.width,
		detail: `side is ${side.bounds.width} wide, front is ${front.bounds.width} wide`,
	})),
};

const backDiffers: Check = {
	name: "back differs",
	part: "back view",
	run: onViews(({ front, back }) => {
		const match = mirrorMatch(back.image, back.bounds);
		const difference = backDifference(front.image, back.image);
		const detail = `back mirrors ${percent(match)} (needs at least ${percent(MIN_SYMMETRY)}) and differs from the front on ${percent(difference)} of shared pixels (needs at least ${percent(MIN_BACK_DIFFERENCE)})`;
		return {
			pass: match >= MIN_SYMMETRY && difference >= MIN_BACK_DIFFERENCE,
			detail,
		};
	}),
};

const sameHeight: Check = {
	name: "same height",
	part: "consistent proportions",
	run: onViews(({ front, side, back }) => {
		const heights = [front, side, back].map((view) => view.bounds.height);
		const spread = Math.max(...heights) - Math.min(...heights);
		return {
			pass: spread <= MAX_HEIGHT_SPREAD,
			detail: `frame heights are ${heights.join(", ")}, within ${MAX_HEIGHT_SPREAD} pixel allowed`,
		};
	}),
};

const definition: EvalDefinition = {
	parts: ["front view", "side view", "back view", "consistent proportions"],
	checks: [threeFrames, frontSymmetric, sideNarrower, backDiffers, sameHeight],
};

export default definition;
