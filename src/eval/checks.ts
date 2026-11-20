import {
	type Image,
	type ImageLayer,
	imageLayers,
	isLayerVisible,
	type Rect,
	renderFrame,
	type Sprite,
} from "../core/index.ts";

export type CheckResult = { pass: boolean; detail: string };
export type Check = {
	name: string;
	part: string;
	run: (sprites: Sprite[]) => CheckResult;
};
export type EvalDefinition = { parts: string[]; checks: Check[] };

export function runChecks(
	definition: EvalDefinition,
	sprites: Sprite[],
): {
	checks: (CheckResult & { name: string; part: string })[];
	unchecked: string[];
} {
	const checks = definition.checks.map((check) => {
		let result: CheckResult;
		try {
			result = check.run(sprites);
		} catch (error) {
			result = {
				pass: false,
				detail: error instanceof Error ? error.message : String(error),
			};
		}
		return { name: check.name, part: check.part, ...result };
	});
	const checkedParts = new Set(definition.checks.map((check) => check.part));
	return {
		checks,
		unchecked: definition.parts.filter((part) => !checkedParts.has(part)),
	};
}

export type AlphaCounts = {
	opaque: number;
	translucent: number;
	nonEmpty: number;
};

export function alphaCounts(image: Image): AlphaCounts {
	let opaque = 0;
	let translucent = 0;
	for (let i = 3; i < image.data.length; i += 4) {
		const alpha = image.data[i] as number;
		if (alpha === 255) opaque++;
		else if (alpha > 0) translucent++;
	}
	return { opaque, translucent, nonEmpty: opaque + translucent };
}

export function opaqueCoverage(image: Image): number {
	return alphaCounts(image).opaque / (image.width * image.height);
}

export function alphaCentroid(image: Image): { x: number; y: number } | null {
	let weight = 0;
	let sumX = 0;
	let sumY = 0;
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const alpha = image.data[(y * image.width + x) * 4 + 3] as number;
			weight += alpha;
			sumX += alpha * x;
			sumY += alpha * y;
		}
	}
	return weight === 0 ? null : { x: sumX / weight, y: sumY / weight };
}

export function alphaBounds(image: Image): Rect | undefined {
	let minX = image.width;
	let minY = image.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			if ((image.data[(y * image.width + x) * 4 + 3] as number) === 0) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	if (maxX < 0) return undefined;
	return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function luma(r: number, g: number, b: number): number {
	return 0.299 * r + 0.587 * g + 0.114 * b;
}

const MIN_HUE_SATURATION = 0.15;

export function hue(r: number, g: number, b: number): number | null {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	const lightness = (max + min) / 2;
	const saturation =
		delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
	if (saturation < MIN_HUE_SATURATION) return null;
	let degrees: number;
	if (max === red) degrees = ((green - blue) / delta) * 60;
	else if (max === green) degrees = ((blue - red) / delta + 2) * 60;
	else degrees = ((red - green) / delta + 4) * 60;
	return ((degrees % 360) + 360) % 360;
}

export function hueDistance(a: number, b: number): number {
	const apart = Math.abs(a - b) % 360;
	return Math.min(apart, 360 - apart);
}

export function opaqueColors(image: Image): Map<string, number> {
	const counts = new Map<string, number>();
	for (let i = 0; i < image.data.length; i += 4) {
		if (image.data[i + 3] !== 255) continue;
		const color = `#${[0, 1, 2]
			.map((c) => (image.data[i + c] as number).toString(16).padStart(2, "0"))
			.join("")}`;
		counts.set(color, (counts.get(color) ?? 0) + 1);
	}
	return counts;
}

export function spriteOfSize(
	sprites: Sprite[],
	width: number,
	height: number,
): Sprite | undefined {
	return sprites.findLast(
		(sprite) => sprite.width === width && sprite.height === height,
	);
}

export function onSpriteOfSize(
	width: number,
	height: number,
	run: (sprite: Sprite) => CheckResult,
): (sprites: Sprite[]) => CheckResult {
	return (sprites) => {
		const sprite = spriteOfSize(sprites, width, height);
		if (!sprite) return { pass: false, detail: `no ${width}x${height} sprite` };
		return run(sprite);
	};
}

export function visibleImageLayers(sprite: Sprite): ImageLayer[] {
	return imageLayers(sprite.root).filter((layer) =>
		isLayerVisible(sprite, layer),
	);
}

export function renderOnly(
	sprite: Sprite,
	layer: ImageLayer,
	frame = 0,
): Image {
	return renderFrame(sprite, frame, (candidate) => candidate === layer);
}

export function renderWithout(
	sprite: Sprite,
	layer: ImageLayer | undefined,
	frame = 0,
): Image {
	return layer
		? renderFrame(
				sprite,
				frame,
				(candidate) => candidate !== layer && isLayerVisible(sprite, candidate),
			)
		: renderFrame(sprite, frame);
}

export function findShadowLayer(
	sprite: Sprite,
	frame = 0,
): ImageLayer | undefined {
	return mostTranslucentLayer(sprite, visibleImageLayers(sprite), frame);
}

export function mostTranslucentLayer(
	sprite: Sprite,
	layers: ImageLayer[],
	frame = 0,
): ImageLayer | undefined {
	let best: ImageLayer | undefined;
	let bestTranslucent = 0;
	for (const layer of layers) {
		const counts = alphaCounts(renderOnly(sprite, layer, frame));
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

export function shadowLayerCheck(
	width: number,
	height: number,
	part: string,
): Check {
	return {
		name: "shadow layer",
		part,
		run: onSpriteOfSize(width, height, (sprite) => {
			const shadow = findShadowLayer(sprite);
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
}

export function shadowDirectionCheck(
	width: number,
	height: number,
	part: string,
): Check {
	return {
		name: "shadow direction",
		part,
		run: onSpriteOfSize(width, height, (sprite) => {
			const shadow = findShadowLayer(sprite);
			if (!shadow) return { pass: false, detail: "there is no shadow layer" };
			const figureCentre = alphaCentroid(renderWithout(sprite, shadow));
			const shadowCentre = alphaCentroid(renderOnly(sprite, shadow));
			if (!figureCentre) return { pass: false, detail: "the figure is empty" };
			if (!shadowCentre) return { pass: false, detail: "the shadow is empty" };
			const dx = shadowCentre.x - figureCentre.x;
			const dy = shadowCentre.y - figureCentre.y;
			const detail = `shadow centroid is ${dx.toFixed(2)} right and ${dy.toFixed(2)} below the figure's`;
			return { pass: dx > 0 && dy > 0, detail };
		}),
	};
}
