import { expect, test } from "bun:test";
import { type Palette, paletteAt } from "./palette.ts";

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
