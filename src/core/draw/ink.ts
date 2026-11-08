import { blendMerge, blendNormal, mul8 } from "../blend.ts";
import type { Rgba } from "../image.ts";

export type InkName =
	| "simple"
	| "alphaCompositing"
	| "copy"
	| "lockAlpha"
	| "eraser"
	| "blur"
	| "jumble";

/** What blur and jumble read: the pre-stroke pixels around the target, clamped at the canvas edge. */
export type Surroundings = {
	/** The pixel at an offset of -1 to 1 in each axis from the target. */
	pixelAt(dx: number, dy: number): Rgba;
	/** A number in [0, 1). */
	random(): number;
};

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

// Observed in Aseprite (image.json eraser cases): opacity is ignored, the brush pixel's alpha scales the backdrop alpha down, and the colour stays.
export function eraseUnderImageBrush(backdrop: Rgba, brushPixel: Rgba): Rgba {
	return { ...backdrop, a: mul8(backdrop.a, 255 - brushPixel.a) };
}

// Colour averages over the pixels that have any alpha; alpha averages over all nine.
// Aseprite then merges that result into the backdrop by the opacity (observed at 128).
function blur(around: Surroundings): Rgba {
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	let visible = 0;
	for (let dy = -1; dy <= 1; dy++) {
		for (let dx = -1; dx <= 1; dx++) {
			const pixel = around.pixelAt(dx, dy);
			a += pixel.a;
			if (pixel.a === 0) continue;
			r += pixel.r;
			g += pixel.g;
			b += pixel.b;
			visible++;
		}
	}
	if (visible === 0) return TRANSPARENT;
	return {
		r: Math.floor(r / visible),
		g: Math.floor(g / visible),
		b: Math.floor(b / visible),
		a: Math.floor(a / 9),
	};
}

function jumble(around: Surroundings): Rgba {
	const dx = Math.floor(around.random() * 3) - 1;
	const dy = Math.floor(around.random() * 3) - 1;
	return around.pixelAt(dx, dy);
}

/**
 * The pixel an RGBA stroke leaves where `color` is stamped over `backdrop`.
 * Opacity is 0 to 255. Blur and jumble ignore the colour and need `around`.
 */
export function applyInk(
	ink: InkName,
	backdrop: Rgba,
	color: Rgba,
	opacity: number,
	around?: Surroundings,
): Rgba {
	switch (ink) {
		case "blur":
		case "jumble":
			if (!around) throw new Error(`The ${ink} ink needs its surroundings`);
			return blendMerge(
				backdrop,
				ink === "blur" ? blur(around) : jumble(around),
				opacity,
			);
		case "simple":
			// Aseprite's output ignores the opacity here.
			return color.a === 0 ? color : blendNormal(backdrop, color, 255);
		case "alphaCompositing":
			return blendNormal(backdrop, color, opacity);
		case "copy":
			return color;
		case "lockAlpha": {
			const { r, g, b } = blendNormal(backdrop, color, opacity);
			return { r, g, b, a: backdrop.a };
		}
		case "eraser":
			return blendMerge(backdrop, TRANSPARENT, opacity);
	}
}
