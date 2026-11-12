import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { layerNamed } from "../../tests/helpers/ase-build.ts";
import { type GroupLayer, walkRenderOrder } from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);
const base = fileURLToPath(
	new URL("../../tests/fixtures/doc/base.aseprite", import.meta.url),
);

function load() {
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.load", {
		path: base,
	}) as unknown as { spriteId: string };
	return { workspace, spriteId };
}

function describeGroup(group: GroupLayer): string {
	return group.children
		.map((child) =>
			child.kind === "group"
				? `${child.name}[${describeGroup(child)}]`
				: child.name,
		)
		.join(",");
}

function create(
	setup: ReturnType<typeof load>,
	position: Record<string, string> = {},
) {
	const { workspace, spriteId } = setup;
	const sprite = workspace.getSprite(spriteId);
	const resolved = Object.fromEntries(
		Object.entries(position).map(([key, name]) => [
			key,
			layerNamed(walkRenderOrder(sprite.root), name).id,
		]),
	);
	registry.callOp(workspace, "layer.create", {
		spriteId,
		name: "new",
		...resolved,
	});
	return describeGroup(sprite.root);
}

function rejected(setup: ReturnType<typeof load>, position: object) {
	const before = describeGroup(setup.workspace.getSprite(setup.spriteId).root);
	try {
		registry.callOp(setup.workspace, "layer.create", {
			spriteId: setup.spriteId,
			...position,
		});
	} catch (error) {
		expect(error).toBeInstanceOf(OpError);
		expect(describeGroup(setup.workspace.getSprite(setup.spriteId).root)).toBe(
			before,
		);
		return error as OpError;
	}
	throw new Error("expected a failure");
}

describe("layer.create position", () => {
	test("goes on top of the root, or of a group given as parentId", () => {
		expect(create(load())).toBe("bg,body,fx[glow,ghost],new");
		expect(create(load(), { parentId: "fx" })).toBe(
			"bg,body,fx[glow,ghost,new]",
		);
	});

	test("goes below or above another layer under its parent", () => {
		expect(create(load(), { below: "body" })).toBe(
			"bg,new,body,fx[glow,ghost]",
		);
		expect(create(load(), { above: "glow" })).toBe(
			"bg,body,fx[glow,new,ghost]",
		);
	});

	test("rejects a position below the background and adds no layer", () => {
		const setup = load();
		const bg = layerNamed(
			walkRenderOrder(setup.workspace.getSprite(setup.spriteId).root),
			"bg",
		).id;
		const error = rejected(setup, { below: bg });
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("below");
	});

	test("rejects parentId combined with above", () => {
		const setup = load();
		const layers = [
			...walkRenderOrder(setup.workspace.getSprite(setup.spriteId).root),
		];
		const error = rejected(setup, {
			parentId: layerNamed(layers, "fx").id,
			above: layerNamed(layers, "glow").id,
		});
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("above");
	});
});
