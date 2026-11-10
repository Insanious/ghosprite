import { describe, expect, test } from "bun:test";
import { checkUndoRedo } from "../../tests/helpers/undo.ts";
import { type Palette, paletteAt, setPalette } from "./palette.ts";
import { createSprite } from "./sprite.ts";

const first: Palette = {
	startFrame: 0,
	colors: [{ r: 1, g: 2, b: 3, a: 255 }],
};
const second: Palette = {
	startFrame: 3,
	colors: [{ r: 4, g: 5, b: 6, a: 255 }],
};

test("paletteAt returns the first palette for frames 0 to 2", () => {
	for (const frame of [0, 1, 2]) {
		expect(paletteAt([first, second], frame)).toBe(first);
	}
});

test("paletteAt returns the second palette from frame 3 on", () => {
	expect(paletteAt([first, second], 3)).toBe(second);
	expect(paletteAt([first, second], 10)).toBe(second);
});

test("paletteAt does not depend on list order", () => {
	expect(paletteAt([second, first], 2)).toBe(first);
});

test("paletteAt throws when no palette starts at or before the frame", () => {
	expect(() => paletteAt([second], 1)).toThrow(RangeError);
});

const spriteWith = (palettes: Palette[]) =>
	createSprite({ width: 1, height: 1, mode: "rgba", palettes });
const red = [{ r: 255, g: 0, b: 0, a: 255 }];

describe("setPalette", () => {
	test("at a frame that has a palette replaces only its colours", () => {
		const sprite = spriteWith([
			{ startFrame: 0, colors: first.colors },
			{ startFrame: 3, colors: second.colors },
		]);
		setPalette(sprite, 3, red);
		expect(sprite.palettes).toEqual([
			{ startFrame: 0, colors: first.colors },
			{ startFrame: 3, colors: red },
		]);
	});

	test.each([
		["an existing", 3],
		["a new", 1],
	])("undoes and redoes on %s start frame", (_, frame) => {
		const sprite = spriteWith([
			{ startFrame: 0, colors: first.colors },
			{ startFrame: 3, colors: second.colors },
		]);
		checkUndoRedo(sprite, () => setPalette(sprite, frame, red));
	});

	test("at a new frame adds a palette in startFrame order", () => {
		const sprite = spriteWith([
			{ startFrame: 0, colors: first.colors },
			{ startFrame: 5, colors: second.colors },
		]);
		setPalette(sprite, 2, red);
		expect(sprite.palettes.map((p) => p.startFrame)).toEqual([0, 2, 5]);
		expect(sprite.palettes[1]?.colors).toBe(red);
	});
});
