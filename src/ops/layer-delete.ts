import { z } from "zod";
import { isEmptyRect } from "../core/image.ts";
import { celCanvasRect, imageLayers, removeLayer } from "../core/sprite.ts";
import type { ChangedRect } from "./registry.ts";
import { defineOp } from "./registry.ts";

export const layerDelete = defineOp({
	name: "layer.delete",
	description: "Remove a layer, or a group with all its children.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const layer = workspace.getLayer(input.spriteId, input.layerId);
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
		removeLayer(sprite, layer);
		return { changed };
	},
});
