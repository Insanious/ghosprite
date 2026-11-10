import { describe, expect, test } from "bun:test";
import { spriteWithLinkedCels } from "../../tests/helpers/linked-cels.ts";
import {
	opaquePixels,
	selectedPixels,
	spriteWithSelectedShape,
} from "../../tests/helpers/selection-fixture.ts";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { wholeSprite } from "../../tests/helpers/whole-sprite.ts";
import { cropSprite } from "./crop.ts";

describe("cropSprite linked cels", () => {
	test("a cel linked across frames is moved once", () => {
		const { sprite, layer } = spriteWithLinkedCels();
		cropSprite(sprite, { x: 1, y: 0, width: 2, height: 2 });
		expect(layer.cels.get(0)?.data.x).toBe(-1);
		expect(layer.cels.get(1)?.data).toBe(layer.cels.get(0)?.data);
	});
});

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

describe("cropSprite undo", () => {
	test("undo and redo restore the sprite", () => {
		const { sprite } = wholeSprite();
		checkUndoRedo(sprite, () => {
			cropSprite(
				sprite,
				{ x: 1, y: 1, width: 4, height: 2 },
				{ r: 9, g: 9, b: 9, a: 0 },
			);
		});
	});
});
