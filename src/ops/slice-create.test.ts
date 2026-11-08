import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);
const bounds = { x: 1, y: 2, width: 3, height: 2 };

function setup() {
	const workspace = new Workspace();
	const created = registry.callOp(workspace, "sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	return {
		workspace,
		spriteId: created.spriteId,
		sprite: workspace.getSprite(created.spriteId),
	};
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

describe("slice.create and slice.delete", () => {
	test("makes one key at frame 0 with no colour", () => {
		const { workspace, spriteId, sprite } = setup();
		const result = registry.callOp(workspace, "slice.create", {
			spriteId,
			name: "s",
			bounds,
			pivot: { x: 1, y: 1 },
		});
		expect(result.changed).toEqual([]);
		expect(sprite.slices[0]).toMatchObject({
			name: "s",
			userData: { color: { r: 0, g: 0, b: 0, a: 0 } },
			keys: [{ frame: 0, bounds, pivot: { x: 1, y: 1 } }],
		});
	});

	test("rejects a duplicate name at name", () => {
		const { workspace, spriteId } = setup();
		registry.callOp(workspace, "slice.create", { spriteId, name: "s", bounds });
		const error = failure(() =>
			registry.callOp(workspace, "slice.create", {
				spriteId,
				name: "s",
				bounds,
			}),
		);
		expect([error.code, error.path]).toEqual(["invalid_input", "name"]);
	});

	test("delete rejects an unknown name and a shared name", () => {
		const { workspace, spriteId, sprite } = setup();
		const missing = failure(() =>
			registry.callOp(workspace, "slice.delete", { spriteId, name: "x" }),
		);
		expect([missing.code, missing.path]).toEqual(["not_found", "name"]);

		registry.callOp(workspace, "slice.create", { spriteId, name: "s", bounds });
		const first = sprite.slices[0];
		if (!first) throw new Error("no slice");
		sprite.slices.push({ ...first });
		const shared = failure(() =>
			registry.callOp(workspace, "slice.delete", { spriteId, name: "s" }),
		);
		expect(shared.code).toBe("invalid_input");
		expect(shared.hint).toBeDefined();
	});
});

describe("tags and slices on disk", () => {
	test("survive sprite.save and sprite.load", () => {
		const { workspace, spriteId } = setup();
		registry.callOp(workspace, "tag.create", {
			spriteId,
			name: "t",
			from: 0,
			to: 0,
			direction: "reverse",
			repeat: 2,
			color: "#102030ff",
		});
		registry.callOp(workspace, "slice.create", { spriteId, name: "s", bounds });
		const path = `${process.env.TMPDIR ?? "/tmp"}/ghosprite-tag-slice-${process.pid}.aseprite`;
		registry.callOp(workspace, "sprite.save", { spriteId, path });
		const loaded = registry.callOp(workspace, "sprite.load", {
			path,
		}) as unknown as {
			spriteId: string;
		};
		const sprite = workspace.getSprite(loaded.spriteId);
		expect(sprite.tags[0]).toMatchObject({
			name: "t",
			direction: "reverse",
			repeat: 2,
			userData: { color: { r: 0x10, g: 0x20, b: 0x30, a: 255 } },
		});
		expect(sprite.slices[0]).toMatchObject({ name: "s", keys: [{ bounds }] });
	});
});
