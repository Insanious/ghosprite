import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { decodePng } from "../core/png.ts";
import { findLayer } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry, type MutationResult } from "./registry.ts";

const registry = createRegistry(operations);

type Result = MutationResult & { spriteId: string; layerId: string };

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as Result;
}

function setup(input: object = { width: 3, height: 2 }) {
	const workspace = new Workspace();
	const created = call(workspace, "sprite.create", input);
	return { workspace, spriteId: created.spriteId };
}

function failure(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected an OpError");
}

describe("sprite.create", () => {
	test("defaults give one 100 ms frame", () => {
		const { workspace, spriteId } = setup();
		const sprite = workspace.getSprite(spriteId);
		expect(spriteId).toBe("sprite-1");
		expect(sprite.frameDurations).toEqual([100]);
		expect(sprite.palettes).toEqual([{ startFrame: 0, colors: [] }]);
	});

	test("a width of 0 is invalid_input", () => {
		const error = failure(() =>
			call(new Workspace(), "sprite.create", {
				width: 0,
				height: 2,
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("width");
	});
});

describe("layer.create", () => {
	test("names layers in order, newest on top", () => {
		const { workspace, spriteId } = setup();
		call(workspace, "layer.create", { spriteId });
		call(workspace, "layer.create", { spriteId });
		const names = workspace
			.getSprite(spriteId)
			.root.children.map((layer) => layer.name);
		expect(names).toEqual(["Layer 1", "Layer 2"]);
	});

	test("a layer created in a group lands inside it", () => {
		const { workspace, spriteId } = setup();
		const group = call(workspace, "layer.create", {
			spriteId,
			group: true,
		});
		expect(findLayer(workspace.getSprite(spriteId), "layer-1")?.name).toBe(
			"Group 1",
		);
		call(workspace, "layer.create", {
			spriteId,
			parentId: group.layerId,
		});
		const sprite = workspace.getSprite(spriteId);
		expect(sprite.root.children).toHaveLength(1);
		const parent = sprite.root.children[0];
		expect(parent?.kind === "group" && parent.children[0]?.id).toBe("layer-2");
	});

	test("a parentId naming an image layer is rejected", () => {
		const { workspace, spriteId } = setup();
		const layer = call(workspace, "layer.create", { spriteId });
		const error = failure(() =>
			call(workspace, "layer.create", {
				spriteId,
				parentId: layer.layerId,
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("parentId");
	});
});

describe("sprite.render", () => {
	test("scale 4 with a grid decodes to 4w+1 by 4h+1", () => {
		const { workspace, spriteId } = setup();
		const result = call(workspace, "sprite.render", {
			spriteId,
			scale: 4,
			grid: true,
		});
		const image = decodePng(result.render?.[0]?.png as Uint8Array, inflateSync);
		expect([image.width, image.height]).toEqual([13, 9]);
	});

	test("a frame out of range is out_of_range", () => {
		const { workspace, spriteId } = setup({
			width: 3,
			height: 2,
			frameCount: 2,
		});
		const error = failure(() =>
			call(workspace, "sprite.render", { spriteId, frames: [5] }),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("frames");
	});

	test("renders every frame by default", () => {
		const { workspace, spriteId } = setup({
			width: 3,
			height: 2,
			frameCount: 2,
		});
		const result = call(workspace, "sprite.render", { spriteId });
		expect(result.render?.map((r) => r.frame)).toEqual([0, 1]);
	});

	test("the schema has no render field", () => {
		const described = registry
			.describeOps()
			.find((op) => op.name === "sprite.render");
		expect(described?.inputSchema.properties).not.toHaveProperty("render");
	});

	test("grid with scale 2 is invalid_input at grid", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			call(workspace, "sprite.render", {
				spriteId,
				scale: 2,
				grid: true,
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("grid");
	});
});
