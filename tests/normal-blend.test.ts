import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { createImage, type Image, setPixel } from "../src/core/image.ts";
import { decodePng } from "../src/core/png.ts";
import { renderFrame } from "../src/core/render.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type GroupLayer,
	type ImageLayer,
	setCel,
} from "../src/core/sprite.ts";

type ColourAt = (x: number, y: number) => [number, number, number, number];

function gradient(
	r: number,
	g: number,
	b: number,
	alphaBase: number,
): ColourAt {
	return (x, y) => [
		r,
		(g + x * 12) % 256,
		(b + y * 12) % 256,
		alphaBase + (x + y) * 3,
	];
}

function celImage(width: number, height: number, colourAt: ColourAt): Image {
	const image = createImage(width, height, "rgba");
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) setPixel(image, x, y, colourAt(x, y));
	}
	return image;
}

function build() {
	const sprite = createSprite({
		width: 16,
		height: 16,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
	});
	const layers = { count: 0 };
	const imageLayer = (
		name: string,
		parent: GroupLayer,
		init: { opacity?: number; visible?: boolean } = {},
	): ImageLayer => {
		const layer = createImageLayer({
			id: `layer-${++layers.count}`,
			name,
			opacity: init.opacity,
			flags: { visible: init.visible ?? true },
		});
		addLayer(sprite, layer, parent);
		return layer;
	};
	const groupLayer = (
		name: string,
		init: { opacity?: number; visible?: boolean } = {},
	): GroupLayer => {
		const layer = createGroupLayer({
			id: `layer-${++layers.count}`,
			name,
			opacity: init.opacity,
			flags: { visible: init.visible ?? true },
		});
		addLayer(sprite, layer, sprite.root);
		return layer;
	};
	const cel = (
		layer: ImageLayer,
		size: number,
		colourAt: ColourAt,
		x: number,
		y: number,
		opacity = 255,
	) => {
		setCel(sprite, layer, 0, {
			image: celImage(size, size, colourAt),
			x,
			y,
			opacity,
		});
	};

	cel(imageLayer("base", sprite.root), 16, gradient(200, 20, 40, 130), 0, 0);
	cel(
		imageLayer("overlay", sprite.root, { opacity: 128 }),
		12,
		gradient(30, 100, 180, 120),
		2,
		2,
		200,
	);
	const group = groupLayer("group", { opacity: 100 });
	cel(imageLayer("shifted", group), 10, gradient(40, 150, 60, 150), -3, -3);
	cel(imageLayer("overhang", group), 8, gradient(240, 160, 20, 200), 12, 5);
	cel(
		imageLayer("hidden", sprite.root, { visible: false }),
		16,
		gradient(255, 255, 255, 160),
		0,
		0,
	);
	const hiddenGroup = groupLayer("hidden-group", { visible: false });
	cel(imageLayer("in-hidden", hiddenGroup), 16, gradient(0, 0, 0, 160), 0, 0);
	return sprite;
}

test("the normal-blend sprite renders byte for byte like Aseprite", async () => {
	const golden = decodePng(
		new Uint8Array(
			await Bun.file(
				new URL("./fixtures/normal-blend.png", import.meta.url),
			).arrayBuffer(),
		),
		inflateSync,
	);
	const rendered = renderFrame(build(), 0);
	expect(rendered.width).toBe(golden.width);
	expect(rendered.height).toBe(golden.height);
	expect(rendered.data).toEqual(golden.data);
});
