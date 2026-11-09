import type { Mask } from "./core/draw/spans.ts";
import type { Layer, Sprite } from "./core/sprite.ts";
import { findLayer } from "./core/sprite.ts";
import { OpError } from "./errors.ts";

export type IdKind = "sprite" | "layer" | "selection";

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

	spriteIds(): string[] {
		return [...this.sprites.keys()];
	}

	hasSprite(id: string): boolean {
		return this.sprites.has(id);
	}

	setSprite(id: string, sprite: Sprite): void {
		this.sprites.set(id, sprite);
	}

	removeSprite(id: string): void {
		this.sprites.delete(id);
	}

	counterSnapshot(): Map<IdKind, number> {
		return new Map(this.counters);
	}

	restoreCounters(snapshot: Map<IdKind, number>): void {
		this.counters.clear();
		for (const [kind, n] of snapshot) this.counters.set(kind, n);
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

	getLayer(spriteId: string, layerId: string, path = "layerId"): Layer {
		const layer = findLayer(this.getSprite(spriteId), layerId);
		if (!layer) {
			throw new OpError(
				"not_found",
				`No layer with id "${layerId}" in ${spriteId}`,
				{ path },
			);
		}
		return layer;
	}

	getSelection(
		spriteId: string,
		selectionId: string,
		path = "selectionId",
	): Mask {
		const mask = this.getSprite(spriteId).selections.get(selectionId);
		if (!mask) {
			throw new OpError(
				"not_found",
				`No selection with id "${selectionId}" in ${spriteId}`,
				{ path },
			);
		}
		return mask;
	}
}
