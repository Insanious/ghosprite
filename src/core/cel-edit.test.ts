import { describe, expect, test } from "bun:test";
import { celCanvas, commitCel } from "./cel-edit.ts";
import { createImage, setPixel } from "./image.ts";
import {
	addLayer,
	type CelData,
	createImageLayer,
	createSprite,
	type ImageLayer,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function setup(background = false) {
	const sprite = createSprite({
		width: 4,
		height: 4,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
		frameDurations: [100, 100],
	});
	const layer = createImageLayer({
		id: "l1",
		name: "L",
		flags: { background },
	});
	addLayer(sprite, layer, sprite.root);
	return { sprite, layer };
}

function putCel(
	sprite: ReturnType<typeof setup>["sprite"],
	layer: ImageLayer,
	frames: number[],
	width: number,
	height: number,
	x: number,
	y: number,
	pixels: [number, number][] = [],
) {
	const image = createImage(width, height, "rgba");
	for (const [px, py] of pixels) setPixel(image, px, py, [9, 8, 7, 255]);
	const data: CelData = {
		image,
		x,
		y,
		opacity: 200,
		userData: createUserData(),
	};
	for (const frame of frames) setCel(sprite, layer, frame, data);
	return data;
}

function edit(width: number, height: number, x: number, y: number) {
	return { image: createImage(width, height, "rgba"), x, y };
}

describe("commitCel", () => {
	test("drawing past a cel's bounds grows it", () => {
		const { sprite, layer } = setup();
		putCel(sprite, layer, [0], 1, 1, 1, 1, [[0, 0]]);
		const canvas = celCanvas(sprite, layer, 0);
		setPixel(canvas.image, 3, 3, [1, 2, 3, 255]);
		const result = commitCel(sprite, layer, 0, canvas);
		expect(result.rect).toEqual({ x: 3, y: 3, width: 1, height: 1 });
		const data = layer.cels.get(0)?.data;
		expect(data).toMatchObject({ x: 1, y: 1, opacity: 200 });
		expect(data?.image.width).toBe(3);
		expect(data?.image.height).toBe(3);
	});

	test("erasing everything removes the cel from both linked frames", () => {
		const { sprite, layer } = setup();
		putCel(sprite, layer, [0, 1], 2, 2, 0, 0, [[1, 1]]);
		const result = commitCel(sprite, layer, 0, edit(4, 4, 0, 0));
		expect(result.frames).toEqual([0, 1]);
		expect(result.rect).toEqual({ x: 1, y: 1, width: 1, height: 1 });
		expect(layer.cels.size).toBe(0);
	});

	test("an edit of a linked cel reports both frames", () => {
		const { sprite, layer } = setup();
		const data = putCel(sprite, layer, [0, 1], 1, 1, 0, 0, [[0, 0]]);
		const canvas = celCanvas(sprite, layer, 1);
		setPixel(canvas.image, 2, 2, [1, 1, 1, 255]);
		const result = commitCel(sprite, layer, 1, canvas);
		expect(result.frames).toEqual([0, 1]);
		expect(layer.cels.get(0)?.data).toBe(data);
		expect(data.image.width).toBe(3);
	});

	test("preciseBounds is cleared by a change and kept by a no-op commit", () => {
		const { sprite, layer } = setup();
		const data = putCel(sprite, layer, [0], 1, 1, 0, 0, [[0, 0]]);
		const precise = { x: 0, y: 0, width: 1, height: 1 };
		data.preciseBounds = precise;
		commitCel(sprite, layer, 0, celCanvas(sprite, layer, 0));
		expect(data.preciseBounds).toBe(precise);
		const canvas = celCanvas(sprite, layer, 0);
		setPixel(canvas.image, 1, 1, [1, 1, 1, 255]);
		commitCel(sprite, layer, 0, canvas);
		expect(data.preciseBounds).toBeUndefined();
	});

	test("a background cel isn't trimmed", () => {
		const { sprite, layer } = setup(true);
		putCel(sprite, layer, [0], 4, 4, 0, 0);
		const canvas = celCanvas(sprite, layer, 0);
		setPixel(canvas.image, 1, 1, [1, 1, 1, 255]);
		commitCel(sprite, layer, 0, canvas);
		const data = layer.cels.get(0)?.data;
		expect(data).toMatchObject({ x: 0, y: 0 });
		expect(data?.image).toMatchObject({ width: 4, height: 4 });
	});

	test("off-canvas pixels of a cel survive a commit made through celCanvas", () => {
		const { sprite, layer } = setup();
		putCel(sprite, layer, [0], 2, 1, -1, 0, [[0, 0]]);
		const canvas = celCanvas(sprite, layer, 0);
		setPixel(canvas.image, 3, 3, [1, 1, 1, 255]);
		commitCel(sprite, layer, 0, canvas);
		const data = layer.cels.get(0)?.data;
		expect(data).toMatchObject({ x: -1, y: 0 });
		expect(Array.from(data?.image.data.slice(0, 4) ?? [])).toEqual([
			9, 8, 7, 255,
		]);
	});

	test("an unchanged commit reports an empty rect", () => {
		const { sprite, layer } = setup();
		putCel(sprite, layer, [0], 2, 2, 1, 1, [[0, 0]]);
		const result = commitCel(sprite, layer, 0, celCanvas(sprite, layer, 0));
		expect(result.rect.width * result.rect.height).toBe(0);
	});

	test("transparent pixels with different colours count as equal", () => {
		const { sprite, layer } = setup();
		const data = putCel(sprite, layer, [0], 1, 1, 0, 0, [[0, 0]]);
		data.image.data.set([5, 5, 5, 0]);
		const canvas = celCanvas(sprite, layer, 0);
		canvas.image.data.fill(0);
		const result = commitCel(sprite, layer, 0, canvas);
		expect(result.rect.width).toBe(0);
	});

	test("an edit with no cel and no pixels creates nothing", () => {
		const { sprite, layer } = setup();
		commitCel(sprite, layer, 0, celCanvas(sprite, layer, 0));
		expect(layer.cels.size).toBe(0);
	});

	test("a new cel has zIndex 0, opacity 255 and empty user data", () => {
		const { sprite, layer } = setup();
		const canvas = celCanvas(sprite, layer, 0);
		setPixel(canvas.image, 2, 1, [1, 1, 1, 255]);
		commitCel(sprite, layer, 0, canvas);
		const cel = layer.cels.get(0);
		expect(cel?.zIndex).toBe(0);
		expect(cel?.data).toMatchObject({ x: 2, y: 1, opacity: 255 });
		expect(cel?.data.userData).toEqual(createUserData());
	});
});
