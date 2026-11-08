import { describe, expect, test } from "bun:test";
import { findLayer } from "../core/sprite.ts";
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

describe("layer.delete", () => {
	test("an unknown layer id is not_found at layerId", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		try {
			call(workspace, "layer.delete", { spriteId, layerId: "nope" });
			throw new Error("expected a failure");
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).code).toBe("not_found");
			expect((error as OpError).path).toBe("layerId");
		}
	});

	test("deleting a group removes its children and reports their cels", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		const group = call(workspace, "layer.create", { spriteId, group: true });
		const child = call(workspace, "layer.create", {
			spriteId,
			parentId: group.layerId,
		});
		call(workspace, "cel.set", {
			spriteId,
			layerId: child.layerId,
			frame: 0,
			x: -1,
			legend: { a: "#ff0000" },
			rows: ["aa", "aa"],
		});
		const result = call(workspace, "layer.delete", {
			spriteId,
			layerId: group.layerId,
		});
		expect(result.changed).toEqual([
			{
				layerId: child.layerId,
				frame: 0,
				rect: { x: 0, y: 0, width: 1, height: 2 },
			},
		]);
		const sprite = workspace.getSprite(spriteId);
		expect(findLayer(sprite, group.layerId)).toBeUndefined();
		expect(findLayer(sprite, child.layerId)).toBeUndefined();
	});
});
