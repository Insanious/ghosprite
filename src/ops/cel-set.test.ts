import { describe, expect, test } from "bun:test";
import { createImage } from "../core/image.ts";
import { renderFrame } from "../core/render.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	setCel,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { celSet } from "./cel-set.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([celSet]);
const legend = { ".": "#00000000", R: "#ff0000", B: { r: 0, g: 0, b: 255 } };

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({ id: workspace.nextId("layer"), name: "L" });
	addLayer(sprite, layer, sprite.root);
	const group = createGroupLayer({ id: workspace.nextId("layer"), name: "G" });
	addLayer(sprite, group, sprite.root);
	return { workspace, spriteId, sprite, layer, group };
}

function run(workspace: Workspace, input: Record<string, unknown>) {
	return registry.callOp(workspace, "cel.set", input);
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

describe("cel.set", () => {
	test("creates a cel with the drawn pixels", () => {
		const { workspace, spriteId, sprite, layer } = setup();
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 1,
			x: 1,
			y: 2,
			opacity: 200,
			legend,
			rows: ["R.", "BR"],
		});
		const cel = layer.cels.get(1);
		expect(cel?.data).toMatchObject({ x: 1, y: 2, opacity: 200 });
		expect(Array.from(cel?.data.image.data ?? [])).toEqual([
			255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 0, 0, 255,
		]);
		expect(result.changed).toEqual([
			{
				layerId: layer.id,
				frame: 1,
				rect: { x: 1, y: 2, width: 2, height: 2 },
			},
		]);
		expect(sprite.frameDurations).toHaveLength(3);
	});

	test("a character missing from the legend points at its row", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend,
				rows: ["RR", "R?"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "invalid_input",
			path: "rows.1",
		});
	});

	test("rows of uneven length are rejected", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend,
				rows: ["RR", "R"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "invalid_input",
			path: "rows.1",
		});
	});

	test("empty rows are rejected", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend,
				rows: [""],
			}),
		);
		expect(error.code).toBe("invalid_input");
	});

	test("a multi-character legend key is rejected", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend: { RR: "#ff0000" },
				rows: ["R"],
			}),
		);
		expect(error.code).toBe("invalid_input");
	});

	test("an indexed legend colour is unsupported at its legend key", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend: { A: { index: 1 } },
				rows: ["A"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "unsupported",
			path: "legend.A",
		});
	});

	test("a group layer target is rejected", () => {
		const { workspace, spriteId, group } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: group.id,
				frame: 0,
				legend,
				rows: ["R"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "invalid_input",
			path: "layerId",
		});
	});

	test("a frame past the end is out_of_range", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 3,
				legend,
				rows: ["R"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "frame",
		});
	});

	test("moving an existing cel reports the union of the old and new rects", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		setCel(sprite, layer, 0, {
			image: createImage(2, 2, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
		});
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 2,
			y: 2,
			legend,
			rows: ["RR", "RR"],
		});
		expect(result.changed).toEqual([
			{
				layerId: layer.id,
				frame: 0,
				rect: { x: 0, y: 0, width: 4, height: 4 },
			},
		]);
	});

	test("a cel partly off-canvas reports a clipped rect", () => {
		const { workspace, spriteId, layer } = setup();
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: -1,
			y: 3,
			legend,
			rows: ["RR", "RR"],
		});
		expect(result.changed[0]?.rect).toEqual({
			x: 0,
			y: 3,
			width: 1,
			height: 1,
		});
	});

	test("a cel entirely off-canvas reports no change", () => {
		const { workspace, spriteId, layer } = setup();
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 10,
			legend,
			rows: ["R"],
		});
		expect(result.changed).toEqual([]);
	});

	test("editing a linked cel reports every linked frame and changes both renders", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		const data = { image: createImage(1, 1, "rgba"), x: 0, y: 0, opacity: 255 };
		setCel(sprite, layer, 0, data);
		setCel(sprite, layer, 2, data);
		const result = run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["R"],
		});
		expect(result.changed.map((c) => c.frame)).toEqual([0, 2]);
		for (const frame of [0, 2]) {
			expect(Array.from(renderFrame(sprite, frame).data.slice(0, 4))).toEqual([
				255, 0, 0, 255,
			]);
		}
	});
});
