import { renderFrame } from "../../src/core/index.ts";
import {
	type Check,
	type EvalDefinition,
	hue,
	hueDistance,
	onSpriteOfSize,
	opaqueColors,
} from "../../src/eval/checks.ts";

const SIZE = 16;
const GREEN_HUE = 120;
const BLUE_HUE = 240;
const RED_HUE = 0;
const HUE_TOLERANCE = 40;
const MIN_GREENS = 3;
const MIN_GREEN_SHARE = 0.5;

function isHue(color: string, target: number): boolean {
	const degrees = hue(
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	);
	return degrees !== null && hueDistance(degrees, target) <= HUE_TOLERANCE;
}

function opaquePixels(data: Uint8Array | Uint8ClampedArray): (string | null)[] {
	const pixels: (string | null)[] = [];
	for (let i = 0; i < data.length; i += 4) {
		pixels.push(
			data[i + 3] === 255
				? `#${[0, 1, 2]
						.map((c) => (data[i + c] as number).toString(16).padStart(2, "0"))
						.join("")}`
				: null,
		);
	}
	return pixels;
}

const greenSlime: Check = {
	name: "green slime",
	part: "green slime",
	run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
		const colors = opaqueColors(renderFrame(sprite, 0));
		let total = 0;
		let greens = 0;
		let greenPixels = 0;
		for (const [color, count] of colors) {
			total += count;
			if (isHue(color, GREEN_HUE)) {
				greens++;
				greenPixels += count;
			}
		}
		const share = total === 0 ? 0 : greenPixels / total;
		const detail = `frame 0 has ${greens} greens covering ${(share * 100).toFixed(0)}% of its opaque pixels, needs at least ${MIN_GREENS} and ${MIN_GREEN_SHARE * 100}%`;
		return {
			pass: greens >= MIN_GREENS && share >= MIN_GREEN_SHARE,
			detail,
		};
	}),
};

function variantCheck(name: string, frame: number, targetHue: number): Check {
	return {
		name,
		part: name,
		run: onSpriteOfSize(SIZE, SIZE, (sprite) => {
			if (frame >= sprite.frameDurations.length) {
				return { pass: false, detail: `there is no frame ${frame}` };
			}
			const base = opaquePixels(renderFrame(sprite, 0).data);
			const variant = opaquePixels(renderFrame(sprite, frame).data);
			const forward = new Map<string, string>();
			const backward = new Map<string, string>();
			for (let i = 0; i < base.length; i++) {
				const from = base[i];
				const to = variant[i];
				if (from === null && to === null) continue;
				if (from === null || to === null) {
					return {
						pass: false,
						detail: `pixel ${i % SIZE},${Math.floor(i / SIZE)} is opaque in only one of frame 0 and frame ${frame}`,
					};
				}
				if (isHue(from, GREEN_HUE)) {
					if (!isHue(to, targetHue)) {
						return {
							pass: false,
							detail: `green ${from} became ${to}, which is not within ${HUE_TOLERANCE} degrees of hue ${targetHue}`,
						};
					}
				} else if (to !== from) {
					return {
						pass: false,
						detail: `non-green ${from} changed to ${to}`,
					};
				}
				const forwardTo = forward.get(from);
				const backwardFrom = backward.get(to);
				if (
					(forwardTo !== undefined && forwardTo !== to) ||
					(backwardFrom !== undefined && backwardFrom !== from)
				) {
					return {
						pass: false,
						detail: `shading changed: ${from} and ${to} do not map one to one`,
					};
				}
				forward.set(from, to);
				backward.set(to, from);
			}
			return {
				pass: true,
				detail: `frame ${frame} keeps frame 0's shading, with greens within ${HUE_TOLERANCE} degrees of hue ${targetHue} and everything else unchanged`,
			};
		}),
	};
}

const definition: EvalDefinition = {
	parts: ["green slime", "blue variant", "red variant"],
	checks: [
		greenSlime,
		variantCheck("blue variant", 1, BLUE_HUE),
		variantCheck("red variant", 2, RED_HUE),
	],
};

export default definition;
