import type { Layer, Sprite } from "./core/sprite.ts";
import { findLayer } from "./core/sprite.ts";
import { OpError } from "./errors.ts";

export type IdKind = "sprite" | "layer";

export class Workspace {
	private readonly sprites = new Map<string, Sprite>();
	private readonly counters = new Map<IdKind, number>();

	nextId(kind: IdKind): string {
		const n = (this.counters.get(kind) ?? 0) + 1;
		this.counters.set(kind, n);
		return `${kind}-${n}`;
	}

	addSprite(sprite: Sprite): string {
		const id = this.nextId("sprite");
		this.sprites.set(id, sprite);
		return id;
	}

	getSprite(id: string): Sprite {
		const sprite = this.sprites.get(id);
		if (!sprite) {
			throw new OpError("not_found", `No sprite with id "${id}"`, {
				path: "spriteId",
			});
		}
		return sprite;
	}

	getLayer(spriteId: string, layerId: string): Layer {
		const layer = findLayer(this.getSprite(spriteId), layerId);
		if (!layer) {
			throw new OpError(
				"not_found",
				`No layer with id "${layerId}" in ${spriteId}`,
				{ path: "layerId" },
			);
		}
		return layer;
	}
}
