import { describe, expect, test } from "bun:test";
import {
	opaquePixels,
	selectedPixels,
	spriteWithSelectedShape,
} from "../../tests/helpers/selection-fixture.ts";
import { cropSprite } from "./crop.ts";

describe("cropSprite", () => {
	test("a selection stays over the pixels it covered", () => {
		const sprite = spriteWithSelectedShape();
		cropSprite(sprite, { x: 1, y: 1, width: 4, height: 3 });
		const onCanvas = selectedPixels(sprite, "selection-1").filter((pixel) => {
			const [x = -1, y = -1] = pixel.split(",").map(Number);
			return x < sprite.width && y < sprite.height && x >= 0 && y >= 0;
		});
		expect(onCanvas).toEqual(opaquePixels(sprite));
	});

	test("a selection keeps its parts outside the canvas, as cels do", () => {
		const sprite = spriteWithSelectedShape();
		cropSprite(sprite, { x: 1, y: 1, width: 4, height: 3 });
		expect(sprite.selections.get("selection-1")?.bounds).toEqual({
			x: 0,
			y: -1,
			width: 3,
			height: 3,
		});
	});
});
