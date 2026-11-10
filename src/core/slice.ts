import { recordSlices } from "./history.ts";
import type { Rect } from "./image.ts";
import type { Sprite } from "./sprite.ts";
import { cloneUserData, type UserData } from "./user-data.ts";

export type SliceKey = {
	frame: number;
	bounds: Rect;
	center?: Rect;
	pivot?: { x: number; y: number };
};

export type Slice = {
	name: string;
	userData: UserData;
	keys: SliceKey[];
};

export function cloneSlice(slice: Slice): Slice {
	return {
		...slice,
		userData: cloneUserData(slice.userData),
		keys: slice.keys.map((key) => ({
			...key,
			bounds: { ...key.bounds },
			...(key.center && { center: { ...key.center } }),
			...(key.pivot && { pivot: { ...key.pivot } }),
		})),
	};
}

export function addSlice(sprite: Sprite, slice: Slice): void {
	recordSlices(sprite);
	// Aseprite puts a new slice first.
	sprite.slices.unshift(slice);
}

export function removeSlice(sprite: Sprite, index: number): void {
	recordSlices(sprite);
	sprite.slices.splice(index, 1);
}

export function sliceKeyAt(slice: Slice, frame: number): SliceKey | undefined {
	let found: SliceKey | undefined;
	for (const key of slice.keys) {
		if (key.frame <= frame && (!found || key.frame >= found.frame)) {
			found = key;
		}
	}
	return found;
}
