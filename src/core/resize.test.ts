import { describe, expect, test } from "bun:test";
import { spriteWithLinkedCels } from "../../tests/helpers/linked-cels.ts";
import {
	opaquePixels,
	selectedPixels,
	spriteWithSelectedShape,
} from "../../tests/helpers/selection-fixture.ts";
import { createImage, getPixel, setPixel } from "./image.ts";
import { resizeImage, resizeSprite } from "./resize.ts";

describe("resizeSprite linked cels", () => {
	test("a cel linked across frames is scaled once", () => {
		const { sprite, layer } = spriteWithLinkedCels();
		resizeSprite(sprite, 6, 4);
		const data = layer.cels.get(0)?.data;
		expect([data?.image.width, data?.image.height]).toEqual([6, 4]);
		expect(layer.cels.get(1)?.data).toBe(data);
	});
});

describe("resizeSprite selections", () => {
	test.each([2, 3])(
		"scaling by %i keeps a selection over its pixels",
		(factor) => {
			const sprite = spriteWithSelectedShape();
			resizeSprite(sprite, sprite.width * factor, sprite.height * factor);
			expect(selectedPixels(sprite, "selection-1")).toEqual(
				opaquePixels(sprite),
			);
		},
	);

	test("doubling doubles a selection's size", () => {
		const sprite = spriteWithSelectedShape();
		resizeSprite(sprite, 12, 8);
		expect(sprite.selections.get("selection-1")?.bounds).toEqual({
			x: 2,
			y: 0,
			width: 6,
			height: 6,
		});
	});

	test("a 1x1 selection shrunk by half keeps one pixel", () => {
		const sprite = spriteWithSelectedShape();
		sprite.selections.set("selection-1", {
			bounds: { x: 3, y: 2, width: 1, height: 1 },
			bits: Uint8Array.from([1]),
		});
		resizeSprite(sprite, 3, 2);
		expect(selectedPixels(sprite, "selection-1")).toEqual(["1,1"]);
	});

	test("an empty selection stays empty", () => {
		const sprite = spriteWithSelectedShape();
		sprite.selections.set("selection-1", {
			bounds: { x: 0, y: 0, width: 0, height: 0 },
			bits: new Uint8Array(0),
		});
		resizeSprite(sprite, 12, 8);
		expect(sprite.selections.get("selection-1")?.bounds.width).toBe(0);
	});
});

describe("resizeImage", () => {
	test("1x1 to 3x2 repeats the pixel", () => {
		const src = createImage(1, 1, "rgba");
		setPixel(src, 0, 0, [9, 8, 7, 255]);
		const out = resizeImage(src, 3, 2);
		expect([out.width, out.height]).toEqual([3, 2]);
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 3; x++) {
				expect(getPixel(out, x, y)).toEqual([9, 8, 7, 255]);
			}
		}
	});

	test("4x4 to 2x2 keeps every other pixel", () => {
		const src = createImage(4, 4, "indexed");
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) setPixel(src, x, y, [y * 4 + x]);
		}
		const out = resizeImage(src, 2, 2);
		expect([0, 1, 2, 3].map((i) => out.data[i])).toEqual([0, 2, 8, 10]);
	});
});
