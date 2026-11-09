import { z } from "zod";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	type Sprite,
	walkRenderOrder,
} from "../core/sprite.ts";
import { layerPositionShape, resolveLayerPosition } from "./layer-position.ts";
import { newLayerUuid } from "./layer-uuid.ts";
import { defineOp } from "./registry.ts";

function countLayers(sprite: Sprite, kind: "image" | "group"): number {
	let count = 0;
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.kind === kind) count++;
	}
	return count;
}

export const layerCreate = defineOp({
	name: "layer.create",
	sprite: "edits",
	description:
		"Add an image layer or a group. It goes on top of its parent's children by default (the root, or the group given as parentId), or directly above or below another layer with above or below. Returns its layerId.",
	input: z.object({
		spriteId: z.string(),
		name: z.string().optional(),
		group: z.boolean().default(false),
		...layerPositionShape,
		opacity: z.number().int().min(0).max(255).default(255),
		visible: z.boolean().default(true),
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const { parent, index } = resolveLayerPosition(sprite, input);
		const kind = input.group ? "group" : "image";
		const name =
			input.name ??
			`${input.group ? "Group" : "Layer"} ${countLayers(sprite, kind) + 1}`;
		const init = {
			id: workspace.nextId("layer"),
			...newLayerUuid(sprite),
			name,
			opacity: input.opacity,
			flags: { visible: input.visible },
		};
		const layer = input.group ? createGroupLayer(init) : createImageLayer(init);
		addLayer(sprite, layer, parent, index);
		return { layerId: layer.id };
	},
});
