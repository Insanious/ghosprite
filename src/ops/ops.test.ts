import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { buildFile, layerChunk } from "../../tests/helpers/ase-build.ts";
import { decodePng } from "../core/png.ts";
import { findLayer, walkRenderOrder } from "../core/sprite.ts";
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
		expect(error.path).toBe("frames.0");
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

describe("legend rows schemas", () => {
	test("cel.set and the draw.line image brush carry the legend description", () => {
		const described = registry.describeOps();
		for (const name of ["cel.set", "draw.line"]) {
			const schema = JSON.stringify(
				described.find((op) => op.name === name)?.inputSchema,
			);
			expect(schema).toContain("are transparent unless mapped");
		}
	});
});

describe("image brush schema", () => {
	test("the image branch of draw.rect's brush states its anchor", () => {
		const rect = registry.describeOps().find((op) => op.name === "draw.rect");
		const brush = JSON.stringify(
			(rect?.inputSchema.properties as Record<string, unknown> | undefined)
				?.brush,
		);
		expect(brush).toMatch(/"description":"[^"]*floor/);
	});
});

describe("sprite.load and sprite.save", () => {
	const fixture = "tests/fixtures/sprites/groups3abc.aseprite";
	const scratch = mkdtempSync(join(tmpdir(), "ghosprite-ops-test-"));
	afterAll(() => rmSync(scratch, { recursive: true, force: true }));

	test("load, save, load gives an equal model", () => {
		const first = new Workspace();
		const { spriteId } = call(first, "sprite.load", { path: fixture });
		const saved = join(scratch, "round-trip.aseprite");
		call(first, "sprite.save", { spriteId, path: saved });
		const second = new Workspace();
		const reloaded = call(second, "sprite.load", { path: saved });
		expect(second.getSprite(reloaded.spriteId)).toEqual(
			first.getSprite(spriteId),
		);
	});

	test("a missing file is not_found at path", () => {
		const error = failure(() =>
			call(new Workspace(), "sprite.load", {
				path: join(scratch, "missing.aseprite"),
			}),
		);
		expect(error.code).toBe("not_found");
		expect(error.path).toBe("path");
	});

	test("a malformed file is invalid_input at path", () => {
		const path = join(scratch, "bad.aseprite");
		writeFileSync(path, "not an aseprite file");
		const error = failure(() => call(new Workspace(), "sprite.load", { path }));
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("path");
	});

	test("an unsupported file is unsupported with a tilemap hint", () => {
		const bytes = readFileSync(fixture);
		const layerChunk = bytes.findIndex(
			(byte, i) => i > 128 && byte === 0x04 && bytes[i + 1] === 0x20,
		);
		const layerTypeOffset = layerChunk + 2 + 2;
		new DataView(bytes.buffer, bytes.byteOffset).setUint16(
			layerTypeOffset,
			2,
			true,
		);
		const path = join(scratch, "tilemap-layer.aseprite");
		writeFileSync(path, bytes);
		const error = failure(() => call(new Workspace(), "sprite.load", { path }));
		expect(error.code).toBe("unsupported");
		expect(error.hint).toContain("Tilemaps");
	});

	test("an unknown blend mode is unsupported with no tilemap hint", () => {
		const path = join(scratch, "blend.aseprite");
		writeFileSync(
			path,
			buildFile({
				frames: [[layerChunk({ name: "a", blend: 99 })]],
			}),
		);
		const error = failure(() => call(new Workspace(), "sprite.load", { path }));
		expect(error.code).toBe("unsupported");
		expect(error.hint).toBeUndefined();
	});

	test("a null user property is unsupported at spriteId and writes no file", () => {
		const { workspace, spriteId } = setup();
		workspace
			.getSprite(spriteId)
			.userData.properties.set("", new Map([["a", { type: "null" }]]));
		const path = join(scratch, "null-property.aseprite");
		const error = failure(() =>
			call(workspace, "sprite.save", { spriteId, path }),
		);
		expect(error.code).toBe("unsupported");
		expect(error.path).toBe("spriteId");
		expect(existsSync(path)).toBe(false);
	});

	test("an unwritable path is invalid_input at path", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			call(workspace, "sprite.save", {
				spriteId,
				path: join(scratch, "no-dir", "out.aseprite"),
			}),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("path");
	});

	test("layer.create gives the new layer a UUID when the others have one", () => {
		const workspace = new Workspace();
		const { spriteId } = call(workspace, "sprite.load", { path: fixture });
		const sprite = workspace.getSprite(spriteId);
		for (const layer of walkRenderOrder(sprite.root)) {
			layer.uuid = crypto.randomUUID();
		}
		const { layerId } = call(workspace, "layer.create", { spriteId });
		expect(workspace.getLayer(spriteId, layerId).uuid).toBeDefined();
		call(workspace, "sprite.save", {
			spriteId,
			path: join(scratch, "uuids.aseprite"),
		});
	});

	test("layer.create adds no UUID when the others have none", () => {
		const { workspace, spriteId } = setup();
		const { layerId } = call(workspace, "layer.create", { spriteId });
		expect(workspace.getLayer(spriteId, layerId).uuid).toBeUndefined();
	});
});
