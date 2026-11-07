import { z } from "zod";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	findLayer,
	type Sprite,
	walkRenderOrder,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { defineOp } from "./registry.ts";

function countLayers(sprite: Sprite, kind: "image" | "group"): number {
	let count = 0;
	for (const layer of walkRenderOrder(sprite.root)) {
		if (layer.kind === kind) count++;
	}
	return count;
}

function resolveParent(sprite: Sprite, parentId: string | undefined) {
	if (parentId === undefined) return sprite.root;
	const parent = findLayer(sprite, parentId);
	if (!parent) {
		throw new OpError("not_found", `No layer with id "${parentId}"`, {
			path: "parentId",
		});
	}
	if (parent.kind !== "group") {
		throw new OpError("invalid_input", `Layer "${parentId}" is not a group`, {
			path: "parentId",
			hint: "parentId must name a group layer",
		});
	}
	return parent;
}

export const layerCreate = defineOp({
	name: "layer.create",
	description:
		"Add an image layer or a group on top of its parent's children. Returns its layerId.",
	input: z.object({
		spriteId: z.string(),
		name: z.string().optional(),
		group: z.boolean().default(false),
		parentId: z.string().optional(),
		opacity: z.number().int().min(0).max(255).default(255),
		visible: z.boolean().default(true),
	}),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		const parent = resolveParent(sprite, input.parentId);
		const kind = input.group ? "group" : "image";
		const name =
			input.name ??
			`${input.group ? "Group" : "Layer"} ${countLayers(sprite, kind) + 1}`;
		const init = {
			id: workspace.nextId("layer"),
			name,
			opacity: input.opacity,
			flags: { visible: input.visible },
		};
		const layer = input.group ? createGroupLayer(init) : createImageLayer(init);
		addLayer(sprite, layer, parent);
		return { layerId: layer.id };
	},
});
