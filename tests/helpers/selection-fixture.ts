import { createImage, setPixel } from "../../src/core/image.ts";
import { renderFrame } from "../../src/core/render.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	type Sprite,
	setCel,
} from "../../src/core/sprite.ts";
import { createUserData } from "../../src/core/user-data.ts";

const SHAPE = [
	[1, 0],
	[2, 0],
	[2, 1],
	[2, 2],
	[3, 2],
];

/** A 6x4 sprite with an asymmetric shape on one layer, and `selection-1` covering exactly that shape. */
export function spriteWithSelectedShape(): Sprite {
	const sprite = createSprite({
		width: 6,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
	});
	const layer = createImageLayer({ id: "l1", name: "L" });
	addLayer(sprite, layer, sprite.root);
	const image = createImage(6, 4, "rgba");
	const bits = new Uint8Array(3 * 3);
	for (const [x, y] of SHAPE as [number, number][]) {
		setPixel(image, x, y, [9, 8, 7, 255]);
		bits[y * 3 + x - 1] = 1;
	}
	setCel(sprite, layer, 0, {
		image,
		x: 0,
		y: 0,
		opacity: 255,
		userData: createUserData(),
	});
	sprite.selections.set("selection-1", {
		bounds: { x: 1, y: 0, width: 3, height: 3 },
		bits,
	});
	return sprite;
}

export function opaquePixels(sprite: Sprite): string[] {
	const image = renderFrame(sprite, 0);
	const pixels: string[] = [];
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			if (image.data[(y * image.width + x) * 4 + 3] !== 0) {
				pixels.push(`${x},${y}`);
			}
		}
	}
	return pixels.sort();
}

export function selectedPixels(sprite: Sprite, id: string): string[] {
	const mask = sprite.selections.get(id);
	if (!mask) throw new Error(`No selection ${id}`);
	const { bounds, bits } = mask;
	const pixels: string[] = [];
	for (let row = 0; row < bounds.height; row++) {
		for (let col = 0; col < bounds.width; col++) {
			if (bits[row * bounds.width + col] !== 0) {
				pixels.push(`${bounds.x + col},${bounds.y + row}`);
			}
		}
	}
	return pixels.sort();
}
