import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

type Result = { spriteId: string; layerId: string; changed: unknown[] };

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as Result;
}

function addBackground(workspace: Workspace, spriteId: string) {
	const { layerId } = call(workspace, "layer.create", { spriteId });
	const layer = workspace.getLayer(spriteId, layerId);
	layer.flags.background = true;
}

function failure(run: () => unknown): OpError {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(OpError);
		return error as OpError;
	}
	throw new Error("expected a failure");
}

describe("sprite.crop", () => {
	test("growing a sprite with a background layer needs a background colour", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		addBackground(workspace, spriteId);
		const error = failure(() =>
			call(workspace, "sprite.crop", {
				spriteId,
				rect: { x: 0, y: 0, width: 4, height: 2 },
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("background");
		expect(error.hint).toBeDefined();
	});

	test("a rect inside the canvas needs no background colour", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		addBackground(workspace, spriteId);
		const result = call(workspace, "sprite.crop", {
			spriteId,
			rect: { x: 1, y: 0, width: 2, height: 2 },
		});
		expect(result.changed).toHaveLength(1);
		expect(workspace.getSprite(spriteId).width).toBe(2);
	});

	test("a 0-width rect fails the schema", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		const error = failure(() =>
			call(workspace, "sprite.crop", {
				spriteId,
				rect: { x: 0, y: 0, width: 0, height: 2 },
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("rect.width");
	});
});

describe("sprite.trim", () => {
	test("an empty sprite is left as it is and reports no changed", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 3,
			height: 2,
		});
		call(workspace, "layer.create", { spriteId });
		const result = call(workspace, "sprite.trim", { spriteId });
		expect(result.changed).toEqual([]);
		const sprite = workspace.getSprite(spriteId);
		expect([sprite.width, sprite.height]).toEqual([3, 2]);
	});

	test("crops to the content of every frame", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.create", {
			width: 8,
			height: 8,
			frameCount: 2,
		});
		const { layerId } = call(workspace, "layer.create", { spriteId });
		const legend = { a: "#ff0000" };
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			x: 2,
			y: 3,
			legend,
			rows: ["a"],
		});
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 1,
			x: 5,
			y: 4,
			legend,
			rows: ["a"],
		});
		const result = call(workspace, "sprite.trim", { spriteId });
		const sprite = workspace.getSprite(spriteId);
		expect([sprite.width, sprite.height]).toEqual([4, 2]);
		expect(result.changed).toHaveLength(2);
	});
});
