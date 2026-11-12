import { expect } from "bun:test";
import {
	type CelData,
	imageLayers,
	type Sprite,
} from "../../src/core/index.ts";

/** Checks that, in every image layer, two cels have the same data id exactly when they hold the same `CelData`. */
export function expectCelIdInvariant(sprite: Sprite): void {
	for (const layer of imageLayers(sprite.root)) {
		const byId = new Map<number, CelData>();
		for (const { data } of layer.cels.values()) {
			expect(Number.isInteger(data.id)).toBe(true);
			expect(data.id).toBeLessThan(sprite.nextCelDataId);
			const seen = byId.get(data.id);
			if (seen) expect(data).toBe(seen);
			byId.set(data.id, data);
		}
		const objects = new Set([...layer.cels.values()].map((cel) => cel.data));
		expect(byId.size).toBe(objects.size);
	}
}
