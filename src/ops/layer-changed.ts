import {
	celCanvasRect,
	imageLayers,
	isEmptyRect,
	type Layer,
	type Sprite,
} from "../core/index.ts";
import type { ChangedRect } from "./registry.ts";

/** Every non-empty cel of an image layer, or of every image layer in a group. */
export function layerChanged(sprite: Sprite, layer: Layer): ChangedRect[] {
	const changed: ChangedRect[] = [];
	for (const imageLayer of layer.kind === "image"
		? [layer]
		: imageLayers(layer)) {
		for (const cel of imageLayer.cels.values()) {
			const rect = celCanvasRect(sprite, cel.data);
			if (isEmptyRect(rect)) continue;
			changed.push({ layerId: imageLayer.id, frame: cel.frame, rect });
		}
	}
	return changed;
}
