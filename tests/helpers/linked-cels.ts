import {
	addLayer,
	createImage,
	createImageLayer,
	createSprite,
	createUserData,
	type ImageLayer,
	type Sprite,
	setCel,
	setPixel,
} from "../../src/core/index.ts";

/** A 3x2 RGBA sprite whose frames 0 and 1 share one cel: a single opaque pixel at (0, 0). */
export function spriteWithLinkedCels(): { sprite: Sprite; layer: ImageLayer } {
	const sprite = createSprite({
		width: 3,
		height: 2,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100],
	});
	const layer = createImageLayer({ id: "l1", name: "L" });
	addLayer(sprite, layer, sprite.root);
	const image = createImage(3, 2, "rgba");
	setPixel(image, 0, 0, [9, 8, 7, 255]);
	const data = { image, x: 0, y: 0, opacity: 255, userData: createUserData() };
	setCel(sprite, layer, 0, data);
	setCel(sprite, layer, 1, data);
	return { sprite, layer };
}
