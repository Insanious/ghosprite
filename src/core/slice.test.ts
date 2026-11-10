import { expect, test } from "bun:test";
import { addSlice, removeSlice, type Slice, sliceKeyAt } from "./slice.ts";
import { createUserData } from "./user-data.ts";

const bounds = { x: 0, y: 0, width: 4, height: 4 };
const slice: Slice = {
	name: "s",
	userData: createUserData(),
	keys: [
		{ frame: 2, bounds },
		{ frame: 5, bounds, pivot: { x: 1, y: 1 } },
	],
};

test("sliceKeyAt is undefined before the first key", () => {
	expect(sliceKeyAt(slice, 1)).toBeUndefined();
});

test("sliceKeyAt returns the latest earlier key between keys", () => {
	expect(sliceKeyAt(slice, 2)).toBe(slice.keys[0]);
	expect(sliceKeyAt(slice, 4)).toBe(slice.keys[0]);
	expect(sliceKeyAt(slice, 5)).toBe(slice.keys[1]);
	expect(sliceKeyAt(slice, 9)).toBe(slice.keys[1]);
});

function named(name: string): Slice {
	return { name, userData: createUserData(), keys: [{ frame: 0, bounds }] };
}

test("addSlice puts the new slice before existing ones", () => {
	const sprite = { slices: [named("a")] };
	addSlice(sprite, named("b"));
	expect(sprite.slices.map((s) => s.name)).toEqual(["b", "a"]);
});

test("removeSlice removes only the slice at the index", () => {
	const sprite = { slices: [named("a"), named("b"), named("c")] };
	removeSlice(sprite, 1);
	expect(sprite.slices.map((s) => s.name)).toEqual(["a", "c"]);
});
