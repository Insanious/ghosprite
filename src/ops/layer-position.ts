import { z } from "zod";
import {
	findBackground,
	findLayer,
	findParent,
	type GroupLayer,
	type Layer,
	type Sprite,
	walkRenderOrder,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";

export const layerPositionShape = {
	above: z
		.string()
		.optional()
		.describe("Place directly above this layer, under the same parent."),
	below: z
		.string()
		.optional()
		.describe("Place directly below this layer, under the same parent."),
	parentId: z
		.string()
		.optional()
		.describe("Place on top of this group's children."),
};

export type LayerPosition = z.infer<z.ZodObject<typeof layerPositionShape>>;

/**
 * Where a layer goes: at most one of `parentId`, `above` and `below`, and with
 * none of them on top of the root. `moving` is a layer about to be moved: the
 * index counts as though it were already out of its parent.
 */
export function resolveLayerPosition(
	sprite: Sprite,
	position: LayerPosition,
	moving?: Layer,
): { parent: GroupLayer; index: number } {
	const given = (["parentId", "above", "below"] as const).filter(
		(field) => position[field] !== undefined,
	);
	const second = given[1];
	if (second) {
		throw new OpError(
			"invalid_input",
			`Give only one of parentId, above and below, not ${given.join(" and ")}`,
			{ path: second },
		);
	}
	const field = given[0];
	if (!field) {
		return { parent: sprite.root, index: siblings(sprite.root, moving).length };
	}

	const targetId = position[field] as string;
	const target = findLayer(sprite, targetId);
	if (!target) {
		throw new OpError("not_found", `No layer with id "${targetId}"`, {
			path: field,
		});
	}
	if (moving && isInside(moving, target)) {
		throw new OpError(
			"invalid_input",
			`Layer "${targetId}" is the layer being moved or inside it`,
			{ path: field, hint: "A layer cannot be placed relative to itself" },
		);
	}

	if (field === "parentId") {
		if (target.kind !== "group") {
			throw new OpError("invalid_input", `Layer "${targetId}" is not a group`, {
				path: field,
				hint: "parentId must name a group layer",
			});
		}
		return { parent: target, index: siblings(target, moving).length };
	}

	const parent = findParent(sprite, target) as GroupLayer;
	const index = siblings(parent, moving).indexOf(target);
	if (
		field === "below" &&
		parent === sprite.root &&
		index === 0 &&
		findBackground(sprite)
	) {
		throw new OpError(
			"invalid_input",
			`Nothing can go below the background layer "${targetId}"`,
			{ path: field, hint: "Nothing can go below the background layer" },
		);
	}
	return { parent, index: field === "above" ? index + 1 : index };
}

function siblings(parent: GroupLayer, moving: Layer | undefined): Layer[] {
	return parent.children.filter((child) => child !== moving);
}

function isInside(moving: Layer, target: Layer): boolean {
	if (moving === target) return true;
	if (moving.kind !== "group") return false;
	for (const layer of walkRenderOrder(moving)) {
		if (layer === target) return true;
	}
	return false;
}
