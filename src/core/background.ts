import { blendNormal } from "./blend.ts";
import { createImage, type Image, type Rgba } from "./image.ts";

export const CHECKER_LIGHT: Rgba = { r: 0xcc, g: 0xcc, b: 0xcc, a: 255 };
export const CHECKER_DARK: Rgba = { r: 0x99, g: 0x99, b: 0x99, a: 255 };

export type Background =
	| { kind: "color"; color: Rgba }
	| { kind: "checker"; square: number };

/** A new RGBA image with `image` blended over the background. Requires an RGBA image. */
export function withBackground(image: Image, background: Background): Image {
	const out = createImage(image.width, image.height, "rgba");
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const i = (y * image.width + x) * 4;
			const src = {
				r: image.data[i] as number,
				g: image.data[i + 1] as number,
				b: image.data[i + 2] as number,
				a: image.data[i + 3] as number,
			};
			const result = blendNormal(backgroundAt(background, x, y), src, 255);
			out.data[i] = result.r;
			out.data[i + 1] = result.g;
			out.data[i + 2] = result.b;
			out.data[i + 3] = result.a;
		}
	}
	return out;
}

function backgroundAt(background: Background, x: number, y: number): Rgba {
	if (background.kind === "color") return background.color;
	const light =
		(Math.floor(x / background.square) + Math.floor(y / background.square)) %
			2 ===
		0;
	return light ? CHECKER_LIGHT : CHECKER_DARK;
}
