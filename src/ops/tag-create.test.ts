import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function setup() {
	const workspace = new Workspace();
	const created = registry.callOp(workspace, "sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	const spriteId = created.spriteId;
	registry.callOp(workspace, "layer.create", { spriteId });
	return { workspace, spriteId, sprite: workspace.getSprite(spriteId) };
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

describe("tag.create and tag.delete", () => {
	test("defaults match Aseprite's newTag", () => {
		const { workspace, spriteId, sprite } = setup();
		const result = registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "a",
			from: 0,
			to: 0,
		});
		expect(result.changed).toEqual([]);
		expect(sprite.tags[0]).toMatchObject({
			name: "a",
			from: 0,
			to: 0,
			direction: "forward",
			repeat: 0,
			userData: { color: { r: 0, g: 0, b: 0, a: 255 } },
		});
	});

	test("rejects a duplicate name at name", () => {
		const { workspace, spriteId } = setup();
		const input = { spriteId, name: "a", from: 0, to: 0 };
		registry.callOp(workspace, "tag.create", input);
		const error = failure(() =>
			registry.callOp(workspace, "tag.create", input),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("name");
	});

	test("rejects from after to and to outside the frames", () => {
		const { workspace, spriteId } = setup();
		const backwards = failure(() =>
			registry.callOp(workspace, "tag.create", {
				spriteId,
				name: "b",
				from: 1,
				to: 0,
			}),
		);
		expect([backwards.code, backwards.path]).toEqual(["invalid_input", "from"]);
		const past = failure(() =>
			registry.callOp(workspace, "tag.create", {
				spriteId,
				name: "c",
				from: 0,
				to: 1,
			}),
		);
		expect([past.code, past.path]).toEqual(["out_of_range", "to"]);
		expect(past.message).toBe("Frame 1 is outside 0..0");
	});

	test("delete rejects an unknown name and a shared name", () => {
		const { workspace, spriteId, sprite } = setup();
		const missing = failure(() =>
			registry.callOp(workspace, "tag.delete", { spriteId, name: "x" }),
		);
		expect([missing.code, missing.path]).toEqual(["not_found", "name"]);

		registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "a",
			from: 0,
			to: 0,
		});
		const first = sprite.tags[0];
		if (!first) throw new Error("no tag");
		sprite.tags.push({ ...first });
		const shared = failure(() =>
			registry.callOp(workspace, "tag.delete", { spriteId, name: "a" }),
		);
		expect(shared.code).toBe("invalid_input");
		expect(shared.hint).toBeDefined();
	});

	test("delete removes only the named tag", () => {
		const { workspace, spriteId, sprite } = setup();
		registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "a",
			from: 0,
			to: 0,
		});
		registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "b",
			from: 0,
			to: 0,
		});
		registry.callOp(workspace, "tag.delete", { spriteId, name: "a" });
		expect(sprite.tags.map((t) => t.name)).toEqual(["b"]);
	});
});
