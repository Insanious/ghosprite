import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import {
	addLayer,
	CoreError,
	createImageLayer,
	createSprite,
	decodePng,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { createRegistry, defineOp } from "./registry.ts";

const touch = defineOp({
	name: "test.touch",
	sprite: "edits",
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
	sprite: "edits",
	description: "Has no render option.",
	input: z.object({ spriteId: z.string() }),
	renderOption: false,
	run: () => ({}),
});

const creates = defineOp({
	name: "test.creates",
	sprite: "creates",
	description: "Adds a 3x1 sprite.",
	input: z.object({}),
	run: (workspace) => ({
		spriteId: workspace.addSprite(
			createSprite({
				width: 3,
				height: 1,
				mode: "rgba",
				palettes: [{ startFrame: 0, colors: [] }],
				frameDurations: [100],
			}),
		),
	}),
});

const explode = defineOp({
	name: "test.explode",
	sprite: "creates",
	description: "Throws a plain Error.",
	input: z.object({}),
	renderOption: false,
	run: () => {
		throw new Error("boom");
	},
});

const reject = defineOp({
	name: "test.reject",
	sprite: "creates",
	description: "Throws a CoreError.",
	input: z.object({}),
	renderOption: false,
	run: () => {
		throw new CoreError("out_of_range", "too far", "try less");
	},
});

const read = defineOp({
	name: "test.read",
	sprite: "reads",
	description: "Reads a sprite.",
	input: z.object({ spriteId: z.string() }),
	renderOption: false,
	run: () => ({}),
});

const registry = createRegistry([touch, bare, explode, reject, creates, read]);

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
		const { workspace, spriteId } = setup();
		expect(registry.callOp(workspace, "test.bare", { spriteId })).toEqual({
			changed: [],
			warnings: [],
		});
	});

	test("a render on an op that creates a sprite draws the created sprite", () => {
		const { workspace } = setup();
		const result = registry.callOp(workspace, "test.creates", {
			render: { scale: 1 },
		});
		const png = result.render?.[0]?.png;
		if (!png) throw new Error("no render");
		expect(decodePng(png, inflateSync).width).toBe(3);
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

	test("a render frame past the end is out_of_range at render.frames.0", () => {
		const { workspace, spriteId } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "test.touch", {
				spriteId,
				render: { frames: [5] },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.frames.0",
		});
	});

	test("a render over the pixel limit is out_of_range at render.scale", () => {
		const workspace = new Workspace();
		const spriteId = workspace.addSprite(
			createSprite({
				width: 100,
				height: 100,
				mode: "rgba",
				palettes: [{ startFrame: 0, colors: [] }],
				frameDurations: [100],
			}),
		);
		const error = thrown(() =>
			registry.callOp(workspace, "test.touch", {
				spriteId,
				render: { scale: 64 },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.scale",
		});
	});

	test("a plain Error from an op becomes an internal OpError", () => {
		const { workspace } = setup();
		const error = thrown(() => registry.callOp(workspace, "test.explode", {}));
		expect(error.toJSON()).toEqual({
			code: "internal",
			message: "boom",
			path: "",
		});
	});

	test("a CoreError from an op keeps its code and hint", () => {
		const { workspace } = setup();
		const error = thrown(() => registry.callOp(workspace, "test.reject", {}));
		expect(error.toJSON()).toEqual({
			code: "out_of_range",
			message: "too far",
			path: "",
			hint: "try less",
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

describe("render background", () => {
	function renderedPixels(
		render: Record<string, unknown>,
		size = { width: 40, height: 4 },
	) {
		const workspace = new Workspace();
		const spriteId = workspace.addSprite(
			createSprite({
				...size,
				mode: "rgba",
				palettes: [{ startFrame: 0, colors: [] }],
				frameDurations: [100],
			}),
		);
		const result = registry.callOp(workspace, "test.touch", {
			spriteId,
			render,
		});
		const png = result.render?.[0]?.png;
		if (!png) throw new Error("no render");
		const { data, width } = decodePng(png, inflateSync);
		const at = (x: number, y: number) => [
			...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
		];
		return { at, workspace, spriteId };
	}

	test("a draw op with a background colour paints it under untouched pixels and leaves the sprite alone", () => {
		const { at, workspace, spriteId } = renderedPixels({
			scale: 1,
			background: "#203040",
		});
		expect(at(0, 0)).toEqual([0x20, 0x30, 0x40, 255]);
		const plain = registry.callOp(workspace, "test.touch", {
			spriteId,
			render: { scale: 1 },
		});
		const png = plain.render?.[0]?.png;
		if (!png) throw new Error("no render");
		expect(decodePng(png, inflateSync).data.subarray(0, 4)).toEqual(
			new Uint8Array([0, 0, 0, 0]),
		);
	});

	test("{index} and a short hex are invalid_input at render.background", () => {
		for (const background of [{ index: 1 }, "#12"]) {
			const { workspace, spriteId } = setup();
			const error = thrown(() =>
				registry.callOp(workspace, "test.touch", {
					spriteId,
					render: { background },
				}),
			);
			expect(error.toJSON()).toMatchObject({
				code: "invalid_input",
				path: "render.background",
			});
		}
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

	test("lists note on ops that edit or create, with or without render, and not on a reads op", () => {
		const described = registry.describeOps();
		const propertiesOf = (name: string): Record<string, unknown> => {
			const schema = described.find((op) => op.name === name)?.inputSchema;
			return (schema?.properties ?? {}) as Record<string, unknown>;
		};
		expect(propertiesOf("test.touch")).toHaveProperty("note");
		expect(propertiesOf("test.creates")).toHaveProperty("note");
		expect(propertiesOf("test.bare")).toHaveProperty("note");
		expect(propertiesOf("test.read")).not.toHaveProperty("note");
	});
});

describe("note", () => {
	test("a string note is accepted", () => {
		const { workspace, spriteId } = setup();
		expect(() =>
			registry.callOp(workspace, "test.touch", { spriteId, note: "helmet" }),
		).not.toThrow();
	});

	test("a non-string note is invalid_input at note", () => {
		const { workspace, spriteId } = setup();
		expect(() =>
			registry.callOp(workspace, "test.touch", { spriteId, note: 5 }),
		).toThrow(expect.objectContaining({ code: "invalid_input", path: "note" }));
	});
});

const addLayerOp = defineOp({
	name: "test.addLayer",
	sprite: "edits",
	description: "Adds an image layer.",
	input: z.object({ spriteId: z.string() }),
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		addLayer(
			sprite,
			createImageLayer({ id: "layer-9", name: "L" }),
			sprite.root,
		);
		return {};
	},
});

const prepareRegistry = createRegistry([addLayerOp, creates]);

describe("prepare", () => {
	test("an edits op returns the parsed spriteId and changes nothing until run", () => {
		const { workspace, spriteId } = setup();
		const prepared = prepareRegistry.prepare(workspace, "test.addLayer", {
			spriteId,
		});
		expect(prepared.sprite).toBe("edits");
		expect(prepared.spriteId).toBe(spriteId);
		expect(workspace.getSprite(spriteId).root.children).toHaveLength(0);
		const ran = prepared.run();
		expect(ran.spriteId).toBe(spriteId);
		expect(workspace.getSprite(spriteId).root.children).toHaveLength(1);
	});

	test("a creates op has no spriteId until run returns the new id", () => {
		const { workspace } = setup();
		const prepared = prepareRegistry.prepare(workspace, "test.creates", {});
		expect(prepared.spriteId).toBeUndefined();
		expect(workspace.spriteIds()).toHaveLength(1);
		const ran = prepared.run();
		expect(workspace.hasSprite(ran.spriteId)).toBe(true);
		expect(workspace.spriteIds()).toHaveLength(2);
	});

	test("bad input is invalid_input before anything runs", () => {
		const { workspace } = setup();
		const error = thrown(() =>
			prepareRegistry.prepare(workspace, "test.addLayer", { spriteId: 1 }),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("spriteId");
	});
});
