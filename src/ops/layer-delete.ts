import { z } from "zod";
import { removeLayer } from "../core/index.ts";
import { layerChanged } from "./layer-changed.ts";
import { defineOp } from "./registry.ts";

export const layerDelete = defineOp({
	name: "layer.delete",
	sprite: "edits",
	description: "Remove a layer, or a group with all its children.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const layer = workspace.getLayer(input.spriteId, input.layerId);
		const changed = layerChanged(sprite, layer);
		removeLayer(sprite, layer);
		return { changed };
	},
});
