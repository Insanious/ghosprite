import { describe, expect, test } from "bun:test";
import { findLayer, getPixel, type ImageLayer } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		layerId: string;
		spriteId: string;
		changed: unknown[];
	};
}

function failure(run: () => void): OpError {
	try {
		run();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

function newSprite() {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width: 8,
		height: 8,
	});
	return { workspace, spriteId };
}

describe("layer.mergeDown", () => {
	test("the bottom layer has nothing to merge into", () => {
		const { workspace, spriteId } = newSprite();
		const { layerId } = call(workspace, "layer.create", { spriteId });
		const error = failure(() =>
			call(workspace, "layer.mergeDown", { spriteId, layerId }),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("layerId");
	});

	test("a group can't be merged, and a layer can't merge into one", () => {
		const { workspace, spriteId } = newSprite();
		const group = call(workspace, "layer.create", { spriteId, group: true });
		const above = call(workspace, "layer.create", { spriteId });
		for (const layerId of [group.layerId, above.layerId]) {
			const error = failure(() =>
				call(workspace, "layer.mergeDown", { spriteId, layerId }),
			);
			expect(error.code).toBe("invalid_input");
			expect(error.path).toBe("layerId");
		}
	});

	test("the lower layer's opacity is baked in where the upper layer has a cel, then reset", () => {
		const { workspace, spriteId } = newSprite();
		const lower = call(workspace, "layer.create", { spriteId, opacity: 200 });
		const upper = call(workspace, "layer.create", { spriteId });
		call(workspace, "cel.set", {
			spriteId,
			layerId: lower.layerId,
			frame: 0,
			legend: { a: "#ffdc643c" },
			rows: ["a"],
		});
		call(workspace, "cel.set", {
			spriteId,
			layerId: upper.layerId,
			frame: 0,
			legend: { a: "#c8323280" },
			rows: ["a"],
		});
		const result = call(workspace, "layer.mergeDown", {
			spriteId,
			layerId: upper.layerId,
		});
		const sprite = workspace.getSprite(spriteId);
		const merged = findLayer(sprite, lower.layerId) as ImageLayer;
		expect(findLayer(sprite, upper.layerId)).toBeUndefined();
		expect(merged.opacity).toBe(255);
		const cel = merged.cels.get(0);
		expect(cel && getPixel(cel.data.image, 0, 0)).toEqual([209, 76, 58, 151]);
		expect(result.changed).toEqual([
			{
				layerId: lower.layerId,
				frame: 0,
				rect: { x: 0, y: 0, width: 1, height: 1 },
			},
		]);
	});
});
