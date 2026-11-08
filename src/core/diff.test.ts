import { expect, test } from "bun:test";
import { diffFrames } from "./diff.ts";
import { createImage, getPixel, setPixel } from "./image.ts";

test("identical images give no changes and empty bounds", () => {
	const img = createImage(3, 3, "rgba");
	setPixel(img, 1, 1, [10, 20, 30, 255]);
	const diff = diffFrames(img, img);
	expect(diff.changedPixels).toBe(0);
	expect(diff.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	expect(getPixel(diff.changes, 1, 1)).toEqual([10, 20, 30, 63]);
});

test("one changed pixel gives count 1, 1x1 bounds and magenta", () => {
	const before = createImage(4, 4, "rgba");
	const after = createImage(4, 4, "rgba");
	setPixel(after, 2, 3, [1, 2, 3, 255]);
	const diff = diffFrames(before, after);
	expect(diff.changedPixels).toBe(1);
	expect(diff.bounds).toEqual({ x: 2, y: 3, width: 1, height: 1 });
	expect(getPixel(diff.changes, 2, 3)).toEqual([255, 0, 255, 255]);
	expect(getPixel(diff.changes, 0, 0)).toEqual([0, 0, 0, 0]);
});

test("alpha 0 pixels with different RGB are not changed", () => {
	const before = createImage(2, 1, "rgba");
	const after = createImage(2, 1, "rgba");
	setPixel(before, 0, 0, [255, 0, 0, 0]);
	setPixel(after, 0, 0, [0, 255, 0, 0]);
	expect(diffFrames(before, after).changedPixels).toBe(0);
});

test("different sizes are padded and only visible new pixels count", () => {
	const before = createImage(1, 1, "rgba");
	const after = createImage(3, 2, "rgba");
	setPixel(after, 2, 1, [9, 9, 9, 128]);
	const diff = diffFrames(before, after);
	expect(diff.before.width).toBe(3);
	expect(diff.before.height).toBe(2);
	expect(diff.changedPixels).toBe(1);
	expect(diff.bounds).toEqual({ x: 2, y: 1, width: 1, height: 1 });
});
