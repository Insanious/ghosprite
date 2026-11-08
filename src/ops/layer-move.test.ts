import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { layerNamed } from "../../tests/helpers/ase-build.ts";
import { type GroupLayer, walkRenderOrder } from "../core/sprite.ts";
import { OpError, type OpErrorCode } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);
const base = fileURLToPath(
	new URL("../../tests/fixtures/doc/base.aseprite", import.meta.url),
);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		spriteId: string;
		changed: { layerId: string }[];
	};
}

function load(path = base) {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.load", { path });
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

function order(workspace: Workspace, spriteId: string): string {
	return describeGroup(workspace.getSprite(spriteId).root);
}

function idOf(workspace: Workspace, spriteId: string, name: string): string {
	return layerNamed(walkRenderOrder(workspace.getSprite(spriteId).root), name)
		.id;
}

function move(
	setup: ReturnType<typeof load>,
	name: string,
	position: Record<string, string> = {},
) {
	const { workspace, spriteId } = setup;
	const resolved = Object.fromEntries(
		Object.entries(position).map(([key, layerName]) => [
			key,
			idOf(workspace, spriteId, layerName),
		]),
	);
	return call(workspace, "layer.move", {
		spriteId,
		layerId: idOf(workspace, spriteId, name),
		...resolved,
	});
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

describe("layer.move", () => {
	test("moves up and down within one parent", () => {
		const up = load();
		move(up, "body", { above: "fx" });
		expect(order(up.workspace, up.spriteId)).toBe("bg,fx[glow,ghost],body");

		const down = load();
		move(down, "fx", { below: "body" });
		expect(order(down.workspace, down.spriteId)).toBe("bg,fx[glow,ghost],body");

		const within = load();
		move(within, "glow", { above: "ghost" });
		expect(order(within.workspace, within.spriteId)).toBe(
			"bg,body,fx[ghost,glow]",
		);
		move(within, "glow", { below: "ghost" });
		expect(order(within.workspace, within.spriteId)).toBe(
			"bg,body,fx[glow,ghost]",
		);
	});

	test("a layer below its target lands directly under it", () => {
		const setup = load();
		move(setup, "body", { below: "fx" });
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,body,fx[glow,ghost]",
		);
		move(setup, "body", { above: "fx" });
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,fx[glow,ghost],body",
		);
	});

	test("moves out of a group", () => {
		const setup = load();
		move(setup, "glow", { below: "body" });
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,glow,body,fx[ghost]",
		);
	});

	test("moves into a group on top, or between its children", () => {
		const top = load();
		move(top, "body", { parentId: "fx" });
		expect(order(top.workspace, top.spriteId)).toBe("bg,fx[glow,ghost,body]");

		const between = load();
		move(between, "body", { above: "glow" });
		expect(order(between.workspace, between.spriteId)).toBe(
			"bg,fx[glow,body,ghost]",
		);
	});

	test("no position puts the layer on top of the root", () => {
		const setup = load();
		move(setup, "glow");
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,body,fx[ghost],glow",
		);
		move(setup, "body");
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,fx[ghost],glow,body",
		);
	});

	test("moving a group carries its children in order", () => {
		const setup = load();
		move(setup, "fx", { below: "body" });
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,fx[glow,ghost],body",
		);
	});

	test("a move that ends where it started succeeds and reports the cels", () => {
		const setup = load();
		const result = move(setup, "body", { above: "bg" });
		expect(order(setup.workspace, setup.spriteId)).toBe(
			"bg,body,fx[glow,ghost]",
		);
		const other = load();
		expect(result.changed).toEqual(
			move(other, "body", { above: "fx" }).changed,
		);
		expect(result.changed.length).toBeGreaterThan(0);
	});

	test("changed lists the cels of the moved layer or of a group's image layers", () => {
		const single = load();
		const changedLayers = (result: { changed: { layerId: string }[] }) => [
			...new Set(result.changed.map((rect) => rect.layerId)),
		];
		expect(changedLayers(move(single, "body", { above: "fx" }))).toEqual([
			idOf(single.workspace, single.spriteId, "body"),
		]);

		const group = load();
		expect(changedLayers(move(group, "fx", { below: "body" })).sort()).toEqual(
			[
				idOf(group.workspace, group.spriteId, "glow"),
				idOf(group.workspace, group.spriteId, "ghost"),
			].sort(),
		);
	});

	describe("errors", () => {
		function rejected(
			name: string,
			position: Record<string, string>,
			expected: { code: OpErrorCode; path: string },
		) {
			const setup = load();
			const before = order(setup.workspace, setup.spriteId);
			const error = failure(() => move(setup, name, position));
			expect({ code: error.code, path: error.path }).toEqual(expected);
			expect(order(setup.workspace, setup.spriteId)).toBe(before);
		}

		test("more than one position field fails at the second", () => {
			rejected(
				"glow",
				{ parentId: "fx", above: "body" },
				{ code: "invalid_input", path: "above" },
			);
			rejected(
				"glow",
				{ above: "body", below: "body" },
				{ code: "invalid_input", path: "below" },
			);
			rejected(
				"glow",
				{ parentId: "fx", below: "body" },
				{ code: "invalid_input", path: "below" },
			);
		});

		test("unknown ids are not_found at their field", () => {
			const setup = load();
			const layerId = idOf(setup.workspace, setup.spriteId, "glow");
			for (const path of ["above", "below", "parentId"]) {
				const error = failure(() =>
					call(setup.workspace, "layer.move", {
						spriteId: setup.spriteId,
						layerId,
						[path]: "layer-99",
					}),
				);
				expect({ code: error.code, path: error.path }).toEqual({
					code: "not_found",
					path,
				});
			}
		});

		test("a parentId that is not a group", () => {
			rejected(
				"glow",
				{ parentId: "body" },
				{ code: "invalid_input", path: "parentId" },
			);
		});

		test("nothing goes below the background", () => {
			rejected(
				"body",
				{ below: "bg" },
				{ code: "invalid_input", path: "below" },
			);
		});

		test("the background cannot move", () => {
			rejected(
				"bg",
				{ above: "fx" },
				{ code: "invalid_input", path: "layerId" },
			);
		});

		test("a layer cannot be placed relative to itself", () => {
			rejected(
				"body",
				{ above: "body" },
				{ code: "invalid_input", path: "above" },
			);
		});

		test("a group cannot move into itself", () => {
			rejected(
				"fx",
				{ parentId: "fx" },
				{ code: "invalid_input", path: "parentId" },
			);
			rejected(
				"fx",
				{ above: "glow" },
				{ code: "invalid_input", path: "above" },
			);
			rejected(
				"fx",
				{ below: "ghost" },
				{ code: "invalid_input", path: "below" },
			);
		});

		test("a group cannot move into its own nested group", () => {
			const setup = load();
			const { workspace, spriteId } = setup;
			const inner = call(workspace, "layer.create", {
				spriteId,
				group: true,
				name: "inner",
				parentId: idOf(workspace, spriteId, "fx"),
			}) as unknown as { layerId: string };
			const before = order(workspace, spriteId);
			const error = failure(() =>
				call(workspace, "layer.move", {
					spriteId,
					layerId: idOf(workspace, spriteId, "fx"),
					parentId: inner.layerId,
				}),
			);
			expect({ code: error.code, path: error.path }).toEqual({
				code: "invalid_input",
				path: "parentId",
			});
			expect(order(workspace, spriteId)).toBe(before);
		});
	});

	test("the order survives save and load", () => {
		const setup = load();
		move(setup, "glow", { below: "body" });
		const directory = mkdtempSync(join(tmpdir(), "ghosprite-"));
		try {
			const path = join(directory, "moved.aseprite");
			call(setup.workspace, "sprite.save", { spriteId: setup.spriteId, path });
			const reloaded = load(path);
			expect(order(reloaded.workspace, reloaded.spriteId)).toBe(
				"bg,glow,body,fx[ghost]",
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
