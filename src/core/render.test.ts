import { describe, expect, test } from "bun:test";
import { blendNormal, mul8 } from "./blend.ts";
import { createImage, getPixel, setPixel } from "./image.ts";
import { renderFrame } from "./render.ts";
import {
	addLayer,
	BLEND_MODES,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type ImageLayer,
	type LayerInit,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

function rgbaSprite(width = 4, height = 4, frames = 1): Sprite {
	return createSprite({
		width,
		height,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: new Array(frames).fill(100),
	});
}

function solidCel(
	sprite: Sprite,
	layer: ImageLayer,
	frame: number,
	colour: number[],
	opts: {
		x?: number;
		y?: number;
		width?: number;
		height?: number;
		opacity?: number;
	} = {},
) {
	const image = createImage(opts.width ?? 1, opts.height ?? 1, "rgba");
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) setPixel(image, x, y, colour);
	}
	return setCel(sprite, layer, frame, {
		image,
		x: opts.x ?? 0,
		y: opts.y ?? 0,
		opacity: opts.opacity ?? 255,
		userData: createUserData(),
	});
}

function imageLayer(sprite: Sprite, init: Partial<LayerInit> = {}) {
	const layer = createImageLayer({ id: init.id ?? "l", name: "l", ...init });
	addLayer(sprite, layer, sprite.root);
	return layer;
}

describe("renderFrame", () => {
	test("a group at opacity 50 renders its children as at 255", () => {
		const sprite = rgbaSprite();
		const group = createGroupLayer({ id: "g", name: "g", opacity: 50 });
		addLayer(sprite, group, sprite.root);
		const child = createImageLayer({ id: "c", name: "c" });
		addLayer(sprite, child, group);
		solidCel(sprite, child, 0, RED);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(RED);
	});

	test("a layer in a hidden group and a reference layer don't render", () => {
		const sprite = rgbaSprite();
		const group = createGroupLayer({
			id: "g",
			name: "g",
			flags: { visible: false },
		});
		addLayer(sprite, group, sprite.root);
		const child = createImageLayer({ id: "c", name: "c" });
		addLayer(sprite, child, group);
		solidCel(sprite, child, 0, RED);
		const reference = imageLayer(sprite, {
			id: "r",
			flags: { reference: true },
		});
		solidCel(sprite, reference, 0, BLUE);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([0, 0, 0, 0]);
	});

	test("cel opacity and layer opacity combine with mul8", () => {
		const sprite = rgbaSprite();
		const layer = imageLayer(sprite, { opacity: 128 });
		solidCel(sprite, layer, 0, RED, { opacity: 128 });
		const expected = blendNormal(
			{ r: 0, g: 0, b: 0, a: 0 },
			{ r: 255, g: 0, b: 0, a: 255 },
			mul8(128, 128),
		);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([
			expected.r,
			expected.g,
			expected.b,
			expected.a,
		]);
		expect(expected.a).toBe(64);
	});

	test("cels clip against the canvas at the right offsets", () => {
		const sprite = rgbaSprite(4, 4);
		const left = imageLayer(sprite, { id: "a" });
		const image = createImage(3, 3, "rgba");
		setPixel(image, 2, 1, RED);
		setCel(sprite, left, 0, {
			image,
			x: -2,
			y: -1,
			opacity: 255,
			userData: createUserData(),
		});
		const right = imageLayer(sprite, { id: "b" });
		solidCel(sprite, right, 0, BLUE, { x: 3, y: 3, width: 3, height: 3 });

		const out = renderFrame(sprite, 0);
		expect(getPixel(out, 0, 0)).toEqual(RED);
		expect(getPixel(out, 3, 3)).toEqual(BLUE);
		expect(getPixel(out, 1, 0)).toEqual([0, 0, 0, 0]);
		expect(getPixel(out, 2, 3)).toEqual([0, 0, 0, 0]);
	});

	test("an indexed cel uses the palette that applies at its frame", () => {
		const sprite = createSprite({
			width: 1,
			height: 1,
			mode: "indexed",
			transparentIndex: 0,
			palettes: [
				{
					startFrame: 0,
					colors: [
						{ r: 0, g: 0, b: 0, a: 0 },
						{ r: 255, g: 0, b: 0, a: 255 },
					],
				},
				{
					startFrame: 3,
					colors: [
						{ r: 0, g: 0, b: 0, a: 0 },
						{ r: 0, g: 0, b: 255, a: 255 },
					],
				},
			],
			frameDurations: [100, 100, 100, 100],
		});
		const layer = imageLayer(sprite);
		const image = createImage(1, 1, "indexed");
		setPixel(image, 0, 0, [1]);
		const data = {
			image,
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		};
		setCel(sprite, layer, 0, data);
		setCel(sprite, layer, 3, data);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(RED);
		expect(getPixel(renderFrame(sprite, 3), 0, 0)).toEqual(BLUE);
	});

	test("the transparent index stays transparent, and a visible background fills the canvas with its colour", () => {
		const sprite = createSprite({
			width: 2,
			height: 1,
			mode: "indexed",
			transparentIndex: 0,
			palettes: [
				{
					startFrame: 0,
					colors: [
						{ r: 9, g: 8, b: 7, a: 255 },
						{ r: 255, g: 0, b: 0, a: 255 },
					],
				},
			],
		});
		const layer = imageLayer(sprite);
		const image = createImage(2, 1, "indexed");
		setPixel(image, 1, 0, [1]);
		setCel(sprite, layer, 0, {
			image,
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([0, 0, 0, 0]);

		const background = createImageLayer({
			id: "bg",
			name: "bg",
			flags: { background: true },
		});
		addLayer(sprite, background, sprite.root, 0);
		const out = renderFrame(sprite, 0);
		expect(getPixel(out, 0, 0)).toEqual([9, 8, 7, 255]);
		expect(getPixel(out, 1, 0)).toEqual(RED);
	});

	test("grayscale pixels render as grey with their alpha", () => {
		const sprite = createSprite({
			width: 1,
			height: 1,
			mode: "grayscale",
			palettes: [{ startFrame: 0, colors: [] }],
		});
		const layer = imageLayer(sprite);
		const image = createImage(1, 1, "grayscale");
		setPixel(image, 0, 0, [100, 255]);
		setCel(sprite, layer, 0, {
			image,
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([
			100, 100, 100, 255,
		]);
	});

	test("a linked cel renders the same pixels in both frames", () => {
		const sprite = rgbaSprite(2, 2, 2);
		const layer = imageLayer(sprite);
		const image = createImage(1, 1, "rgba");
		setPixel(image, 0, 0, RED);
		const data = {
			image,
			x: 1,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		};
		setCel(sprite, layer, 0, data);
		setCel(sprite, layer, 1, data);
		expect(renderFrame(sprite, 0).data).toEqual(renderFrame(sprite, 1).data);
		expect(getPixel(renderFrame(sprite, 1), 1, 0)).toEqual(RED);
	});

	test("every blend mode renders", () => {
		for (const blendMode of BLEND_MODES) {
			const sprite = rgbaSprite();
			solidCel(sprite, imageLayer(sprite, { id: "a" }), 0, RED);
			const top = imageLayer(sprite, { id: "b", blendMode });
			solidCel(sprite, top, 0, [10, 200, 90, 180]);
			expect(() => renderFrame(sprite, 0)).not.toThrow();
		}
	});

	test("a multiply layer blends with the layers below", () => {
		const sprite = rgbaSprite();
		solidCel(sprite, imageLayer(sprite, { id: "a" }), 0, [200, 100, 50, 255]);
		const top = imageLayer(sprite, { id: "b", blendMode: "multiply" });
		solidCel(sprite, top, 0, [128, 128, 128, 255]);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([100, 50, 25, 255]);
	});

	test("a negative z-index moves a cel below a layer in another group", () => {
		const sprite = rgbaSprite();
		const groupA = createGroupLayer({ id: "ga", name: "ga" });
		addLayer(sprite, groupA, sprite.root);
		const a = createImageLayer({ id: "a", name: "a" });
		addLayer(sprite, a, groupA);
		const groupB = createGroupLayer({ id: "gb", name: "gb" });
		addLayer(sprite, groupB, sprite.root);
		const b = createImageLayer({ id: "b", name: "b" });
		addLayer(sprite, b, groupB);
		solidCel(sprite, a, 0, RED);
		const cel = solidCel(sprite, b, 0, BLUE);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(BLUE);
		cel.zIndex = -2;
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(RED);
	});

	test("a hidden layer still takes an order slot", () => {
		const sprite = rgbaSprite();
		solidCel(sprite, imageLayer(sprite, { id: "a" }), 0, RED);
		imageLayer(sprite, { id: "h", flags: { visible: false } });
		const cel = solidCel(sprite, imageLayer(sprite, { id: "b" }), 0, BLUE);
		cel.zIndex = -1;
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(BLUE);
	});

	test("a cel sorted below the background layer is still drawn on top of it", () => {
		const sprite = rgbaSprite();
		const background = imageLayer(sprite, {
			id: "bg",
			flags: { background: true },
		});
		solidCel(sprite, background, 0, RED);
		const cel = solidCel(sprite, imageLayer(sprite, { id: "t" }), 0, BLUE);
		cel.zIndex = -5;
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual(BLUE);
	});

	test("an all-zero source pixel leaves the backdrop alone, other alpha-0 pixels blend", () => {
		const sprite = rgbaSprite();
		solidCel(sprite, imageLayer(sprite, { id: "a" }), 0, [200, 10, 10, 0]);
		const top = imageLayer(sprite, { id: "b" });
		solidCel(sprite, top, 0, [0, 0, 0, 0]);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([200, 10, 10, 0]);
		solidCel(sprite, top, 0, [5, 5, 5, 0]);
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([5, 5, 5, 0]);
	});

	test("an indexed source pixel at the transparent index leaves the backdrop alone", () => {
		const sprite = createSprite({
			width: 1,
			height: 1,
			mode: "indexed",
			palettes: [
				{
					startFrame: 0,
					colors: [
						{ r: 7, g: 7, b: 7, a: 255 },
						{ r: 200, g: 10, b: 10, a: 0 },
					],
				},
			],
		});
		for (const [id, index] of [
			["a", 1],
			["b", 0],
		] as const) {
			const layer = imageLayer(sprite, { id });
			const image = createImage(1, 1, "indexed");
			setPixel(image, 0, 0, [index]);
			setCel(sprite, layer, 0, {
				image,
				x: 0,
				y: 0,
				opacity: 255,
				userData: createUserData(),
			});
		}
		expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([200, 10, 10, 0]);
	});

	describe("with composeGroups", () => {
		test("group opacity applies once to the combined children", () => {
			const sprite = rgbaSprite();
			sprite.composeGroups = true;
			const group = createGroupLayer({ id: "g", name: "g", opacity: 128 });
			addLayer(sprite, group, sprite.root);
			for (const [id, colour] of [
				["r", RED],
				["b", BLUE],
			] as const) {
				const child = createImageLayer({ id, name: id });
				addLayer(sprite, child, group);
				solidCel(sprite, child, 0, colour);
			}
			expect(getPixel(renderFrame(sprite, 0), 0, 0)).toEqual([0, 0, 255, 128]);
		});

		test("a child's z-index doesn't move it out of its group", () => {
			const sprite = rgbaSprite(2, 1);
			sprite.composeGroups = true;
			solidCel(sprite, imageLayer(sprite, { id: "l" }), 0, [255, 255, 0, 255], {
				width: 2,
			});
			const group = createGroupLayer({ id: "g", name: "g" });
			addLayer(sprite, group, sprite.root);
			const red = createImageLayer({ id: "r", name: "r" });
			addLayer(sprite, red, group);
			solidCel(sprite, red, 0, RED);
			const blue = createImageLayer({ id: "b", name: "b" });
			addLayer(sprite, blue, group);
			const cel = solidCel(sprite, blue, 0, BLUE, { width: 2 });
			cel.zIndex = -10;
			const out = renderFrame(sprite, 0);
			expect(getPixel(out, 0, 0)).toEqual(RED);
			expect(getPixel(out, 1, 0)).toEqual(BLUE);
		});
	});
});
