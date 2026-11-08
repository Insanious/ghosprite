import { describe, expect, test } from "bun:test";
import { findLayer, type ImageLayer } from "../core/sprite.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		layerId?: string;
		spriteId: string;
		changed: unknown[];
	};
}

describe("sprite.flatten", () => {
	test("a sprite with no layers is left as it is", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 4,
			height: 4,
		});
		const result = call(workspace, "sprite.flatten", { spriteId });
		expect(result.layerId).toBeUndefined();
		expect(result.changed).toEqual([]);
		expect(workspace.getSprite(spriteId).root.children).toEqual([]);
	});

	test("layers become one Flattened layer holding the trimmed render", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 6,
			height: 6,
		});
		const a = call(workspace, "layer.create", { spriteId });
		const b = call(workspace, "layer.create", { spriteId });
		for (const [layerId, x] of [
			[a.layerId, 1],
			[b.layerId, 3],
		] as const) {
			call(workspace, "cel.set", {
				spriteId,
				layerId,
				frame: 0,
				x,
				y: 2,
				legend: { r: "#ff0000" },
				rows: ["r"],
			});
		}
		const result = call(workspace, "sprite.flatten", { spriteId });
		const sprite = workspace.getSprite(spriteId);
		expect(sprite.root.children).toHaveLength(1);
		const layer = findLayer(sprite, result.layerId ?? "") as ImageLayer;
		expect(layer.name).toBe("Flattened");
		const cel = layer.cels.get(0);
		expect(cel?.data).toMatchObject({ x: 1, y: 2 });
		expect(cel?.data.image).toMatchObject({ width: 3, height: 1 });
		expect(result.changed).toEqual([
			{
				layerId: layer.id,
				frame: 0,
				rect: { x: 1, y: 2, width: 3, height: 1 },
			},
		]);
	});
});
