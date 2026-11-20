import {
	type ImageLayer,
	imageLayers,
	isLayerVisible,
	renderFrame,
	type Sprite,
} from "../../src/core/index.ts";
import {
	alphaCentroid,
	alphaCounts,
	type Check,
	type CheckResult,
	type EvalDefinition,
	opaqueCoverage,
} from "../../src/eval/checks.ts";

const WIDTH = 32;
const HEIGHT = 48;
const MIN_FIGURE_COVERAGE = 0.1;

function canvasSprite(sprites: Sprite[]): Sprite | undefined {
	return sprites.findLast(
		(sprite) => sprite.width === WIDTH && sprite.height === HEIGHT,
	);
}

function visibleImageLayers(sprite: Sprite): ImageLayer[] {
	return imageLayers(sprite.root).filter((layer) =>
		isLayerVisible(sprite, layer),
	);
}

function renderOnly(sprite: Sprite, layer: ImageLayer) {
	return renderFrame(sprite, 0, (candidate) => candidate === layer);
}

function findShadow(sprite: Sprite): ImageLayer | undefined {
	let best: ImageLayer | undefined;
	let bestTranslucent = 0;
	for (const layer of visibleImageLayers(sprite)) {
		const counts = alphaCounts(renderOnly(sprite, layer));
		if (counts.translucent === 0 || counts.translucent * 2 < counts.nonEmpty) {
			continue;
		}
		if (counts.translucent > bestTranslucent) {
			best = layer;
			bestTranslucent = counts.translucent;
		}
	}
	return best;
}

function renderFigure(sprite: Sprite, shadow: ImageLayer | undefined) {
	return shadow
		? renderFrame(
				sprite,
				0,
				(layer) => layer !== shadow && isLayerVisible(sprite, layer),
			)
		: renderFrame(sprite, 0);
}

function onCanvasSprite(
	run: (sprite: Sprite) => CheckResult,
): (sprites: Sprite[]) => CheckResult {
	return (sprites) => {
		const sprite = canvasSprite(sprites);
		if (!sprite) {
			return { pass: false, detail: `no ${WIDTH}x${HEIGHT} sprite` };
		}
		return run(sprite);
	};
}

const canvas: Check = {
	name: "canvas",
	part: "figure",
	run: (sprites) =>
		canvasSprite(sprites)
			? { pass: true, detail: `a ${WIDTH}x${HEIGHT} sprite exists` }
			: { pass: false, detail: `no ${WIDTH}x${HEIGHT} sprite` },
};

const figure: Check = {
	name: "figure",
	part: "figure",
	run: onCanvasSprite((sprite) => {
		const coverage = opaqueCoverage(renderFigure(sprite, findShadow(sprite)));
		const percent = (coverage * 100).toFixed(1);
		return coverage >= MIN_FIGURE_COVERAGE
			? { pass: true, detail: `${percent}% of the canvas is opaque` }
			: {
					pass: false,
					detail: `${percent}% of the canvas is opaque, needs at least ${MIN_FIGURE_COVERAGE * 100}%`,
				};
	}),
};

const shadowLayer: Check = {
	name: "shadow layer",
	part: "shadow",
	run: onCanvasSprite((sprite) => {
		const shadow = findShadow(sprite);
		if (!shadow) {
			return {
				pass: false,
				detail:
					"no visible image layer is at least half translucent on frame 0",
			};
		}
		const layers = visibleImageLayers(sprite);
		const below = layers
			.slice(0, layers.indexOf(shadow))
			.find((layer) => alphaCounts(renderOnly(sprite, layer)).nonEmpty > 0);
		return below
			? {
					pass: false,
					detail: `shadow layer "${shadow.name}" is above "${below.name}", which has pixels`,
				}
			: {
					pass: true,
					detail: `"${shadow.name}" is translucent and below every other layer with pixels`,
				};
	}),
};

const shadowDirection: Check = {
	name: "shadow direction",
	part: "shadow",
	run: onCanvasSprite((sprite) => {
		const shadow = findShadow(sprite);
		if (!shadow) return { pass: false, detail: "there is no shadow layer" };
		const figureCentre = alphaCentroid(renderFigure(sprite, shadow));
		const shadowCentre = alphaCentroid(renderOnly(sprite, shadow));
		if (!figureCentre) return { pass: false, detail: "the figure is empty" };
		if (!shadowCentre) return { pass: false, detail: "the shadow is empty" };
		const dx = shadowCentre.x - figureCentre.x;
		const dy = shadowCentre.y - figureCentre.y;
		const detail = `shadow centroid is ${dx.toFixed(2)} right and ${dy.toFixed(2)} below the figure's`;
		return { pass: dx > 0 && dy > 0, detail };
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
	checks: [canvas, figure, shadowLayer, shadowDirection],
};

export default definition;
