import type { Rect } from "./image.ts";
import type { UserData } from "./user-data.ts";

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

export function addSlice(sprite: { slices: Slice[] }, slice: Slice): void {
	// Aseprite puts a new slice first.
	sprite.slices.unshift(slice);
}

export function removeSlice(sprite: { slices: Slice[] }, index: number): void {
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
