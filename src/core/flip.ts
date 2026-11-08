import { bytesPerPixel, type Image } from "./image.ts";
import { type CelData, imageLayers, type Sprite } from "./sprite.ts";

export type FlipDirection = "horizontal" | "vertical";

function swapPixels(image: Image, a: number, b: number): void {
	const size = bytesPerPixel(image.mode);
	for (let i = 0; i < size; i++) {
		const first = a * size + i;
		const second = b * size + i;
		const held = image.data[first] as number;
		image.data[first] = image.data[second] as number;
		image.data[second] = held;
	}
}

export function flipImage(image: Image, direction: FlipDirection): void {
	if (direction === "horizontal") {
		for (let y = 0; y < image.height; y++) {
			for (let x = 0; x < Math.floor(image.width / 2); x++) {
				swapPixels(
					image,
					y * image.width + x,
					y * image.width + image.width - 1 - x,
				);
			}
		}
		return;
	}
	for (let y = 0; y < Math.floor(image.height / 2); y++) {
		for (let x = 0; x < image.width; x++) {
			swapPixels(
				image,
				y * image.width + x,
				(image.height - 1 - y) * image.width + x,
			);
		}
	}
}

/** Mirrors every cel inside the canvas. Linked cels are flipped once. */
export function flipSprite(sprite: Sprite, direction: FlipDirection): void {
	const flipped = new Set<CelData>();
	for (const layer of imageLayers(sprite.root)) {
		for (const { data } of layer.cels.values()) {
			if (flipped.has(data)) continue;
			flipped.add(data);
			if (direction === "horizontal") {
				data.x = sprite.width - data.image.width - data.x;
			} else {
				data.y = sprite.height - data.image.height - data.y;
			}
			flipImage(data.image, direction);
			delete data.preciseBounds;
		}
	}
}
