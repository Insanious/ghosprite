import { imageLayers, type Sprite } from "../core/sprite.ts";
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
