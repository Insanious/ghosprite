import { blendMerge, blendNormal } from "../blend.ts";
import type { Rgba } from "../image.ts";

export type InkName =
	| "simple"
	| "alphaCompositing"
	| "copy"
	| "lockAlpha"
	| "eraser";

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * The pixel an RGBA stroke leaves where `color` is stamped over `backdrop`.
 * Opacity is 0 to 255.
 */
export function applyInk(
	ink: InkName,
	backdrop: Rgba,
	color: Rgba,
	opacity: number,
): Rgba {
	switch (ink) {
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
