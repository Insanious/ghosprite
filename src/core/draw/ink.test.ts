import { expect, test } from "bun:test";
import { applyInk } from "./ink.ts";

const red = { r: 255, g: 0, b: 0, a: 255 };
const clear = { r: 0, g: 0, b: 0, a: 0 };

test("the eraser leaves a transparent pixel transparent", () => {
	expect(applyInk("eraser", clear, red, 255)).toEqual(clear);
	expect(applyInk("eraser", clear, red, 128)).toEqual(clear);
});

test("a partial eraser keeps a pixel's colour and lowers its alpha", () => {
	const pixel = { r: 10, g: 20, b: 30, a: 255 };
	expect(applyInk("eraser", pixel, red, 128)).toEqual({ ...pixel, a: 127 });
});

test("the simple ink ignores opacity and an alpha 0 colour copies", () => {
	const backdrop = { r: 1, g: 2, b: 3, a: 255 };
	expect(applyInk("simple", backdrop, red, 1)).toEqual(red);
	const ghost = { r: 9, g: 8, b: 7, a: 0 };
	expect(applyInk("simple", backdrop, ghost, 255)).toEqual(ghost);
});

test("the copy ink ignores opacity", () => {
	expect(applyInk("copy", red, clear, 0)).toEqual(clear);
});

test("lock alpha keeps the backdrop alpha, even when transparent", () => {
	expect(applyInk("lockAlpha", clear, red, 255)).toEqual({ ...red, a: 0 });
	expect(applyInk("lockAlpha", { r: 0, g: 0, b: 0, a: 77 }, red, 255).a).toBe(
		77,
	);
});

test("alpha compositing at opacity 0 leaves an opaque backdrop alone", () => {
	expect(applyInk("alphaCompositing", red, clear, 0)).toEqual(red);
});
