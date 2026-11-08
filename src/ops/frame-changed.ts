import { imageLayers, type Sprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import type { ChangedRect } from "./registry.ts";

/** The whole canvas of every image layer at each frame from `first` to `last`. */
export function wholeCanvas(
	sprite: Sprite,
	first: number,
	last: number,
): ChangedRect[] {
	const rect = { x: 0, y: 0, width: sprite.width, height: sprite.height };
	const changed: ChangedRect[] = [];
	for (const layer of imageLayers(sprite.root)) {
		for (let frame = first; frame <= last; frame++) {
			changed.push({ layerId: layer.id, frame, rect });
		}
	}
	return changed;
}

export function checkExistingFrame(sprite: Sprite, frame: number) {
	if (frame >= sprite.frameDurations.length) {
		throw new OpError(
			"out_of_range",
			`Frame ${frame} is outside 0..${sprite.frameDurations.length - 1}`,
			{ path: "frame" },
		);
	}
}
