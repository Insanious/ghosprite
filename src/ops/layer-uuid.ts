import { type Sprite, walkRenderOrder } from "../core/index.ts";

/** A new layer gets a uuid only if the sprite's layers have them. */
export function newLayerUuid(sprite: Sprite): { uuid?: string } {
	const hasUuids = [...walkRenderOrder(sprite.root)].some(
		(layer) => layer.uuid !== undefined,
	);
	return hasUuids ? { uuid: crypto.randomUUID() } : {};
}
