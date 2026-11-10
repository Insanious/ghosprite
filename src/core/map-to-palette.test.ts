import { expect, test } from "bun:test";
import { bayerMatrix } from "./dither.ts";
import { createImage, setPixel } from "./image.ts";
import { mapSpriteToPalette } from "./map-to-palette.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	linkCels,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

const options = {
	dithering: "none",
	matrix: bayerMatrix(8),
	factor: 1,
} as const;

function spriteWithCel(opacity: number) {
	const sprite = createSprite({
		width: 4,
		height: 4,
		mode: "rgba",
		palettes: [
			{
				startFrame: 0,
				colors: [
					{ r: 0, g: 0, b: 0, a: 0 },
					{ r: 9, g: 8, b: 7, a: 255 },
				],
			},
		],
		frameDurations: [100, 100],
	});
	const layer = createImageLayer({ id: "a", name: "A" });
	addLayer(sprite, layer, sprite.root);
	const image = createImage(2, 2, "rgba");
	setPixel(image, 0, 0, [200, 0, 0, 255]);
	setCel(sprite, layer, 0, {
		image,
		x: 0,
		y: 0,
		opacity,
		userData: createUserData(),
	});
	return { sprite, layer };
}

test("linked cels are converted once and each frame is reported once", () => {
	const { sprite, layer } = spriteWithCel(255);
	linkCels(sprite, layer, [0, 1]);

	const changed = mapSpriteToPalette(sprite, options);

	expect(layer.cels.get(0)?.data).toBe(layer.cels.get(1)?.data);
	expect(changed.map((c) => c.frame)).toEqual([0, 1]);
});

test("a cel with opacity below 255 ends at 255", () => {
	const { sprite, layer } = spriteWithCel(100);

	mapSpriteToPalette(sprite, options);

	expect(layer.cels.get(0)?.data.opacity).toBe(255);
});
