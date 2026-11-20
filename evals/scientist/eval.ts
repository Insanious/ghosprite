import {
	type Check,
	type EvalDefinition,
	findShadowLayer,
	onSpriteOfSize,
	opaqueCoverage,
	renderWithout,
	shadowDirectionCheck,
	shadowLayerCheck,
	spriteOfSize,
} from "../../src/eval/checks.ts";

const WIDTH = 32;
const HEIGHT = 48;
const MIN_FIGURE_COVERAGE = 0.1;

const canvas: Check = {
	name: "canvas",
	part: "figure",
	run: (sprites) =>
		spriteOfSize(sprites, WIDTH, HEIGHT)
			? { pass: true, detail: `a ${WIDTH}x${HEIGHT} sprite exists` }
			: { pass: false, detail: `no ${WIDTH}x${HEIGHT} sprite` },
};

const figure: Check = {
	name: "figure",
	part: "figure",
	run: onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const coverage = opaqueCoverage(
			renderWithout(sprite, findShadowLayer(sprite)),
		);
		const percent = (coverage * 100).toFixed(1);
		return coverage >= MIN_FIGURE_COVERAGE
			? { pass: true, detail: `${percent}% of the canvas is opaque` }
			: {
					pass: false,
					detail: `${percent}% of the canvas is opaque, needs at least ${MIN_FIGURE_COVERAGE * 100}%`,
				};
	}),
};

const definition: EvalDefinition = {
	parts: [
		"figure",
		"hood and visor",
		"respirator",
		"gloves and boots",
		"turned top-down view",
		"shadow",
	],
	checks: [
		canvas,
		figure,
		shadowLayerCheck(WIDTH, HEIGHT, "shadow"),
		shadowDirectionCheck(WIDTH, HEIGHT, "shadow"),
	],
};

export default definition;
