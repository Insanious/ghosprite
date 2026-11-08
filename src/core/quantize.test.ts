import { describe, expect, test } from "bun:test";
import { createImage, type Image, type Rgba, rgbaHex } from "./image.ts";
import { quantizeImages } from "./quantize.ts";
import { quantizeSprite } from "./quantize-sprite.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

function imageOf(pixels: number[][], width = pixels.length): Image {
	const image = createImage(width, Math.ceil(pixels.length / width), "rgba");
	pixels.forEach((p, i) => {
		image.data.set(p, i * 4);
	});
	return image;
}

const hexes = (colors: Parameters<typeof rgbaHex>[0][]) =>
	colors.map(rgbaHex).sort();

const FOUR = [
	[255, 0, 0, 255],
	[0, 255, 0, 255],
	[0, 0, 255, 255],
	[10, 20, 30, 255],
];
const FOUR_HEX = ["#ff0000ff", "#00ff00ff", "#0000ffff", "#0a141eff"].sort();

describe("quantizeImages", () => {
	test("opaque keeps the exact colours of a small image", () => {
		const palette = quantizeImages([imageOf(FOUR)], {
			maxColors: 8,
			withAlpha: true,
			opaque: true,
		});
		expect(hexes(palette)).toEqual(FOUR_HEX);
	});

	test("not opaque puts transparent black at index 0", () => {
		const palette = quantizeImages([imageOf([...FOUR, [9, 9, 9, 0]])], {
			maxColors: 8,
			withAlpha: true,
			opaque: false,
		});
		expect(rgbaHex(palette[0] as Rgba)).toBe("#00000000");
		expect(hexes(palette.slice(1))).toEqual(FOUR_HEX);
	});

	test("an image with more colours gets at most maxColors entries", () => {
		const pixels = Array.from({ length: 200 }, (_, i) => [
			i,
			(i * 7) % 256,
			255 - i,
			255,
		]);
		for (const opaque of [true, false]) {
			const palette = quantizeImages([imageOf(pixels, 20)], {
				maxColors: 16,
				withAlpha: true,
				opaque,
			});
			expect(palette.length).toBeGreaterThan(1);
			expect(palette.length).toBeLessThanOrEqual(16);
		}
	});

	test("two colours allowed merge everything into one after the reserved entry", () => {
		const palette = quantizeImages([imageOf(FOUR)], {
			maxColors: 2,
			withAlpha: true,
			opaque: false,
		});
		expect(palette.map(rgbaHex)).toEqual(["#00000000", "#424547ff"]);
	});

	test("withAlpha false ignores alpha", () => {
		const image = imageOf([
			[10, 20, 30, 40],
			[10, 20, 30, 200],
			[50, 60, 70, 0],
		]);
		const palette = quantizeImages([image], {
			maxColors: 4,
			withAlpha: false,
			opaque: true,
		});
		expect(palette.map(rgbaHex)).toEqual(["#0a141eff"]);
	});

	test("withAlpha keeps distinct alphas apart", () => {
		const image = imageOf([
			[10, 20, 30, 40],
			[10, 20, 30, 200],
		]);
		const palette = quantizeImages([image], {
			maxColors: 4,
			withAlpha: true,
			opaque: true,
		});
		expect(hexes(palette)).toEqual(["#0a141e28", "#0a141ec8"]);
	});
});

describe("quantizeSprite", () => {
	function spriteWith(layers: { background: boolean }[]): Sprite {
		const sprite = createSprite({
			width: 2,
			height: 1,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
		});
		layers.forEach(({ background }, i) => {
			const layer = createImageLayer({
				id: `l${i}`,
				name: `l${i}`,
				flags: { background },
			});
			addLayer(sprite, layer, sprite.root);
			const image = createImage(2, 1, "rgba");
			image.data.set(
				i === 0 ? [255, 0, 0, 255, 255, 0, 0, 255] : [0, 0, 255, 255],
			);
			setCel(sprite, layer, 0, {
				image,
				x: 0,
				y: 0,
				opacity: 255,
				userData: createUserData(),
			});
		});
		return sprite;
	}
	const options = { maxColors: 8, withAlpha: true };

	test("a lone background layer is opaque", () => {
		const palette = quantizeSprite(spriteWith([{ background: true }]), options);
		expect(palette.map(rgbaHex)).toEqual(["#ff0000ff"]);
	});

	test("a lone ordinary layer reserves index 0", () => {
		const palette = quantizeSprite(
			spriteWith([{ background: false }]),
			options,
		);
		expect(palette.map(rgbaHex)).toEqual(["#00000000", "#ff0000ff"]);
	});

	test("a background layer with another layer reserves index 0", () => {
		const palette = quantizeSprite(
			spriteWith([{ background: true }, { background: false }]),
			options,
		);
		expect(palette[0] && rgbaHex(palette[0])).toBe("#00000000");
		expect(palette.length).toBe(3);
	});
});
