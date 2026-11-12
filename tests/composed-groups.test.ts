import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
	addLayer,
	createGroupLayer,
	createImage,
	createImageLayer,
	createSprite,
	createUserData,
	decodePng,
	type GroupLayer,
	type Image,
	type ImageLayer,
	type LayerInit,
	renderFrame,
	setCel,
	setPixel,
} from "../src/core/index.ts";

// Mirrors tests/fixtures/composed-groups.lua; change both together.
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

function celImage(size: number, colourAt: ColourAt): Image {
	const image = createImage(size, size, "rgba");
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) setPixel(image, x, y, colourAt(x, y));
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
	sprite.composeGroups = true;
	let count = 0;
	const nextId = () => `layer-${++count}`;
	const imageLayer = (
		parent: GroupLayer,
		name: string,
		init: Partial<LayerInit> = {},
	): ImageLayer => {
		const layer = createImageLayer({ id: nextId(), name, ...init });
		addLayer(sprite, layer, parent);
		return layer;
	};
	const groupLayer = (
		parent: GroupLayer,
		name: string,
		init: Partial<LayerInit>,
	): GroupLayer => {
		const layer = createGroupLayer({ id: nextId(), name, ...init });
		addLayer(sprite, layer, parent);
		return layer;
	};
	const cel = (
		layer: ImageLayer,
		size: number,
		colourAt: ColourAt,
		x: number,
		y: number,
		zIndex = 0,
	) => {
		const data = {
			image: celImage(size, colourAt),
			x,
			y,
			opacity: 255,
			userData: createUserData(),
		};
		setCel(sprite, layer, 0, data, zIndex);
	};

	cel(imageLayer(sprite.root, "base"), 16, gradient(200, 20, 40, 130), 0, 0);
	const group = groupLayer(sprite.root, "group", {
		opacity: 150,
		blendMode: "multiply",
	});
	cel(
		imageLayer(group, "blended", { blendMode: "screen" }),
		12,
		gradient(30, 100, 180, 140),
		1,
		1,
	);
	cel(imageLayer(group, "raised"), 10, gradient(40, 150, 60, 170), 4, 4, 1);
	cel(imageLayer(group, "above-raised"), 10, gradient(240, 160, 20, 190), 2, 6);
	cel(
		imageLayer(group, "hidden", { flags: { visible: false } }),
		16,
		gradient(255, 255, 255, 160),
		0,
		0,
	);
	const nested = groupLayer(group, "nested", { opacity: 200 });
	cel(imageLayer(nested, "inner"), 8, gradient(90, 20, 220, 200), 7, 0);
	return sprite;
}

test("the composed-groups sprite renders byte for byte like Aseprite", async () => {
	const golden = decodePng(
		new Uint8Array(
			await Bun.file(
				new URL("./fixtures/composed-groups-f0.png", import.meta.url),
			).arrayBuffer(),
		),
		inflateSync,
	);
	const rendered = renderFrame(build(), 0);
	expect(rendered.width).toBe(golden.width);
	expect(rendered.height).toBe(golden.height);
	expect(rendered.data).toEqual(golden.data);
});
