import { z } from "zod";
import { addLayer, removeLayer } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { layerChanged } from "./layer-changed.ts";
import { layerPositionShape, resolveLayerPosition } from "./layer-position.ts";
import { defineOp } from "./registry.ts";

export const layerMove = defineOp({
	name: "layer.move",
	description:
		"Move a layer, or a group with its children, within its parent or into another group. It goes on top of the root by default, on top of `parentId`, or directly `above`/`below` another layer.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
		...layerPositionShape,
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const layer = workspace.getLayer(input.spriteId, input.layerId);
		if (layer.flags.background) {
			throw new OpError("invalid_input", "The background layer cannot move", {
				path: "layerId",
				hint: "The background stays at the bottom",
			});
		}
		const { parent, index } = resolveLayerPosition(sprite, input, layer);
		removeLayer(sprite, layer);
		addLayer(sprite, layer, parent, index);
		return { changed: layerChanged(sprite, layer) };
	},
});
