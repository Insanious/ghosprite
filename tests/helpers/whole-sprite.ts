import {
	addLayer,
	addSlice,
	createGroupLayer,
	createImage,
	createImageLayer,
	createSprite,
	createUserData,
	type ImageLayer,
	insertTag,
	type Sprite,
	setCel,
	setPixel,
} from "../../src/core/index.ts";

function celData(
	width: number,
	height: number,
	x: number,
	y: number,
	pixels: [number, number, number, number, number, number][],
) {
	const image = createImage(width, height, "rgba");
	for (const [px, py, r, g, b, a] of pixels)
		setPixel(image, px, py, [r, g, b, a]);
	return { image, x, y, opacity: 255, userData: createUserData() };
}

/**
 * A 6x4 sprite of two frames: a background layer and a group holding an image layer,
 * each with its two frames linked, and a layer above them with one cel. The group's cel has
 * `preciseBounds`. There is a slice with `center` and `pivot`, a tag and a selection.
 */
export function wholeSprite(): {
	sprite: Sprite;
	background: ImageLayer;
	top: ImageLayer;
} {
	const sprite = createSprite({
		width: 6,
		height: 4,
		mode: "rgba",
		palettes: [
			{
				startFrame: 0,
				colors: [
					{ r: 0, g: 0, b: 0, a: 255 },
					{ r: 255, g: 255, b: 255, a: 255 },
					{ r: 200, g: 40, b: 40, a: 255 },
				],
			},
		],
		frameDurations: [100, 100],
	});
	const background = createImageLayer({
		id: "bg",
		name: "Background",
		flags: { background: true },
	});
	addLayer(sprite, background, sprite.root);
	const bgData = celData(6, 4, 0, 0, [
		[0, 0, 0, 0, 0, 255],
		[5, 3, 255, 255, 255, 255],
	]);
	setCel(sprite, background, 0, bgData);
	setCel(sprite, background, 1, bgData);

	const group = createGroupLayer({ id: "g", name: "Group" });
	addLayer(sprite, group, sprite.root);
	const inner = createImageLayer({ id: "inner", name: "Inner" });
	addLayer(sprite, inner, group);
	const innerData = {
		...celData(3, 2, 1, 1, [
			[0, 0, 200, 40, 40, 255],
			[2, 1, 10, 20, 30, 128],
		]),
		preciseBounds: { x: 1, y: 1, width: 3, height: 2 },
	};
	setCel(sprite, inner, 0, innerData);
	setCel(sprite, inner, 1, innerData);

	const top = createImageLayer({ id: "top", name: "Top" });
	addLayer(sprite, top, sprite.root);
	setCel(sprite, top, 0, celData(2, 2, 2, 1, [[1, 0, 0, 90, 200, 255]]));

	addSlice(sprite, {
		name: "slice",
		userData: createUserData(),
		keys: [
			{
				frame: 0,
				bounds: { x: 1, y: 1, width: 4, height: 2 },
				center: { x: 1, y: 1, width: 2, height: 1 },
				pivot: { x: 2, y: 1 },
			},
		],
	});
	insertTag(sprite, {
		name: "tag",
		from: 0,
		to: 1,
		direction: "forward",
		repeat: 0,
		userData: createUserData(),
	});
	sprite.selections.set("selection-1", {
		bounds: { x: 1, y: 1, width: 2, height: 2 },
		bits: new Uint8Array([1, 0, 1, 1]),
	});
	return { sprite, background, top };
}
