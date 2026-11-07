import { describe, expect, test } from "bun:test";
import { addLayer, createGroupLayer, createSprite } from "./core/sprite.ts";
import { OpError } from "./errors.ts";
import { Workspace } from "./workspace.ts";

function newSprite() {
	return createSprite({
		width: 1,
		height: 1,
		mode: "rgba",
		palettes: [{ startFrame: 0, colors: [] }],
	});
}

function notFound(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("Expected an OpError");
}

describe("Workspace", () => {
	test("hands out sequential ids per kind", () => {
		const workspace = new Workspace();
		expect(workspace.addSprite(newSprite())).toBe("sprite-1");
		expect(workspace.addSprite(newSprite())).toBe("sprite-2");
		expect(workspace.nextId("layer")).toBe("layer-1");
		expect(workspace.nextId("layer")).toBe("layer-2");
	});

	test("finds sprites and layers", () => {
		const workspace = new Workspace();
		const sprite = newSprite();
		const id = workspace.addSprite(sprite);
		const layer = createGroupLayer({
			id: workspace.nextId("layer"),
			name: "g",
		});
		addLayer(sprite, layer, sprite.root);
		expect(workspace.getSprite(id)).toBe(sprite);
		expect(workspace.getLayer(id, "layer-1")).toBe(layer);
	});

	test("a missing sprite or layer is not_found", () => {
		const workspace = new Workspace();
		const id = workspace.addSprite(newSprite());
		const sprite = notFound(() => workspace.getSprite("sprite-9"));
		const layer = notFound(() => workspace.getLayer(id, "layer-9"));
		expect(sprite.toJSON()).toMatchObject({
			code: "not_found",
			path: "spriteId",
		});
		expect(layer.toJSON()).toMatchObject({
			code: "not_found",
			path: "layerId",
		});
	});
});
