import { z } from "zod";
import { flattenSprite } from "../core/merge.ts";
import { createImageLayer, findBackground } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { requireRgba } from "../target.ts";
import { newLayerUuid } from "./layer-uuid.ts";
import { defineOp } from "./registry.ts";

export const spriteFlatten = defineOp({
	name: "sprite.flatten",
	description:
		"Replace all layers with one holding the rendered frames: the background layer if the sprite has one, otherwise a new layer named Flattened. Returns its layerId, or nothing if the sprite has no layers.",
	input: z.object({ spriteId: z.string() }),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		if (sprite.root.children.length === 0) return {};
		const target =
			findBackground(sprite) ??
			createImageLayer({
				id: workspace.nextId("layer"),
				...newLayerUuid(sprite),
				name: "Flattened",
			});
		if (target.kind !== "image") {
			throw new OpError("internal", "The background layer is a group", {
				path: "",
			});
		}
		const changes = flattenSprite(sprite, target);
		return {
			layerId: target.id,
			changed: changes.map(({ frame, rect }) => ({
				layerId: target.id,
				frame,
				rect,
			})),
		};
	},
});
