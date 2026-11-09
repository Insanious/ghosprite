import { describe, expect, test } from "bun:test";
import { setCel } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { getImageLayer } from "../target.ts";
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

function setup() {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width: 3,
		height: 2,
		frameCount: 2,
	});
	const { layerId } = call(workspace, "layer.create", { spriteId });
	return { workspace, spriteId, layerId };
}

describe("cel.delete", () => {
	test("a background layer is unsupported", () => {
		const { workspace, spriteId, layerId } = setup();
		const layer = workspace.getLayer(spriteId, layerId);
		layer.flags.background = true;
		try {
			call(workspace, "cel.delete", { spriteId, layerId, frame: 0 });
			throw new Error("expected a failure");
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).code).toBe("unsupported");
		}
	});

	test("deleting one linked cel leaves the other with the same pixels", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { a: "#ff0000" },
			rows: ["aa", "aa"],
		});
		const sprite = workspace.getSprite(spriteId);
		const layer = getImageLayer(workspace, spriteId, layerId);
		const data = layer.cels.get(0)?.data;
		if (!data) throw new Error("expected a cel");
		setCel(sprite, layer, 1, data);
		const result = call(workspace, "cel.delete", {
			spriteId,
			layerId,
			frame: 0,
		});
		expect(result.changed).toEqual([
			{ layerId, frame: 0, rect: { x: 0, y: 0, width: 2, height: 2 } },
		]);
		expect(layer.cels.has(0)).toBe(false);
		expect(layer.cels.get(1)?.data).toBe(data);
		expect(Array.from(data.image.data)).toEqual(
			Array.from({ length: 16 }, (_, i) =>
				i % 4 === 0 || i % 4 === 3 ? 255 : 0,
			),
		);
	});

	test("deleting a missing cel reports no change", () => {
		const { workspace, spriteId, layerId } = setup();
		const result = call(workspace, "cel.delete", {
			spriteId,
			layerId,
			frame: 1,
		});
		expect(result.changed).toEqual([]);
	});
});
