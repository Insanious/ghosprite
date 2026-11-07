import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createSprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { createRegistry, defineOp } from "./registry.ts";

const touch = defineOp({
	name: "test.touch",
	description: "Reports the given frames as changed.",
	input: z.object({
		spriteId: z.string(),
		touched: z.array(z.object({ frame: z.number() })).default([]),
	}),
	run: (_workspace, input) => ({
		changed: input.touched.map(({ frame }) => ({
			layerId: "layer-1",
			frame,
			rect: { x: 0, y: 0, width: 1, height: 1 },
		})),
	}),
});

const bare = defineOp({
	name: "test.bare",
	description: "Has no render option.",
	input: z.object({}),
	renderOption: false,
	run: () => ({}),
});

const registry = createRegistry([touch, bare]);

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 2,
			height: 2,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	return { workspace, spriteId };
}

function thrown(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("Expected an OpError");
}

describe("callOp", () => {
	test("a wrong-typed nested field is invalid_input with a dotted path", () => {
		const { workspace, spriteId } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "test.touch", {
				spriteId,
				touched: [{ frame: 0 }, { frame: 0 }, { frame: "x" }],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "invalid_input",
			path: "touched.2.frame",
		});
	});

	test("an unknown op is unknown_op", () => {
		const { workspace } = setup();
		const error = thrown(() => registry.callOp(workspace, "nope", {}));
		expect(error.code).toBe("unknown_op");
		expect(error.path).toBe("");
	});

	test("the result defaults to no changes and no warnings", () => {
		const { workspace } = setup();
		expect(registry.callOp(workspace, "test.bare", {})).toEqual({
			changed: [],
			warnings: [],
		});
	});

	test("render: {} returns PNGs for exactly the changed frames", () => {
		const { workspace, spriteId } = setup();
		const result = registry.callOp(workspace, "test.touch", {
			spriteId,
			touched: [{ frame: 2 }, { frame: 1 }, { frame: 2 }],
			render: {},
		});
		expect(result.render?.map((r) => r.frame)).toEqual([1, 2]);
		expect(result.render?.[0]?.png[1]).toBe("P".charCodeAt(0));
	});

	test("render: {} with nothing changed returns frame 0", () => {
		const { workspace, spriteId } = setup();
		const result = registry.callOp(workspace, "test.touch", {
			spriteId,
			render: {},
		});
		expect(result.render?.map((r) => r.frame)).toEqual([0]);
	});

	test("render.frames overrides the changed frames", () => {
		const { workspace, spriteId } = setup();
		const result = registry.callOp(workspace, "test.touch", {
			spriteId,
			touched: [{ frame: 1 }],
			render: { frames: [0, 2] },
		});
		expect(result.render?.map((r) => r.frame)).toEqual([0, 2]);
	});

	test("a render frame past the end is out_of_range at render.frames", () => {
		const { workspace, spriteId } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "test.touch", {
				spriteId,
				render: { frames: [5] },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.frames",
		});
	});

	test("no render field means no render in the result", () => {
		const { workspace, spriteId } = setup();
		const result = registry.callOp(workspace, "test.touch", { spriteId });
		expect(result.render).toBeUndefined();
	});

	test("render.grid without a large enough scale is invalid_input at render.grid", () => {
		const { workspace, spriteId } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "test.touch", {
				spriteId,
				render: { grid: true },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "invalid_input",
			path: "render.grid",
		});
	});
});

describe("describeOps", () => {
	test("includes the render field except for an op that opts out", () => {
		const described = registry.describeOps();
		const propertiesOf = (name: string): Record<string, unknown> => {
			const schema = described.find((op) => op.name === name)?.inputSchema;
			return (schema?.properties ?? {}) as Record<string, unknown>;
		};
		expect(propertiesOf("test.touch")).toHaveProperty("render");
		expect(propertiesOf("test.bare")).not.toHaveProperty("render");
		const render = propertiesOf("test.touch").render as {
			required?: string[];
		};
		expect(render.required ?? []).not.toContain("scale");
	});
});
