import { z } from "zod";
import { mergeLayerDown } from "../core/merge.ts";
import { findParent } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { defineOp } from "./registry.ts";

export const layerMergeDown = defineOp({
	name: "layer.mergeDown",
	description:
		"Merge an image layer into the image layer directly below it, which keeps its own id and name, and remove it.",
	input: z.object({
		spriteId: z.string(),
		layerId: z.string(),
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		if (sprite.mode !== "rgba") {
			throw new OpError("unsupported", `Cannot edit a ${sprite.mode} sprite`, {
				hint: "Only RGBA sprites are supported",
			});
		}
		const upper = workspace.getLayer(input.spriteId, input.layerId);
		const siblings = findParent(sprite, upper)?.children ?? [];
		const lower = siblings[siblings.indexOf(upper) - 1];
		if (!lower) {
			throw new OpError(
				"invalid_input",
				`Layer "${upper.name}" has no layer below it`,
				{
					path: "layerId",
					hint: "Pick a layer that is not the bottom one in its group",
				},
			);
		}
		if (upper.kind !== "image" || lower.kind !== "image") {
			throw new OpError(
				"invalid_input",
				"Only an image layer can be merged into an image layer",
				{
					path: "layerId",
					hint: "Neither the layer nor the one below it may be a group",
				},
			);
		}
		const changes = mergeLayerDown(sprite, upper, lower);
		return {
			changed: changes.map(({ frame, rect }) => ({
				layerId: lower.id,
				frame,
				rect,
			})),
		};
	},
});
