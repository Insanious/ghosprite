import type { Rgba } from "./image.ts";
import { quantizeImages } from "./quantize.ts";
import { renderFrame } from "./render.ts";
import { findBackground, type Sprite, walkRenderOrder } from "./sprite.ts";

/** The palette Aseprite builds from every rendered frame of the sprite. */
export function quantizeSprite(
	sprite: Sprite,
	options: { maxColors: number; withAlpha: boolean },
): Rgba[] {
	const layerCount = [...walkRenderOrder(sprite.root)].length;
	const opaque = findBackground(sprite) !== undefined && layerCount === 1;
	const frames = sprite.frameDurations.map((_, frame) =>
		renderFrame(sprite, frame),
	);
	return quantizeImages(frames, { ...options, opaque });
}
