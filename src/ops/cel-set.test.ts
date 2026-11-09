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
import { createUserData } from "../core/user-data.ts";
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

	test("a render frame out of range fails without writing the cel", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			run(workspace, {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend,
				rows: ["R"],
				render: { frames: [5] },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.frames",
		});
		expect(layer.cels.size).toBe(0);
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

	test("an indexed legend colour past the palette is out of range at its legend key", () => {
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
			code: "out_of_range",
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

	test("moving an existing cel reports the pixels that changed", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		setCel(sprite, layer, 0, {
			image: createImage(2, 2, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
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
				rect: { x: 2, y: 2, width: 2, height: 2 },
			},
		]);
	});

	test("a transparent right column is trimmed", () => {
		const { workspace, spriteId, layer } = setup();
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["R.", "R."],
		});
		expect(layer.cels.get(0)?.data.image.width).toBe(1);
	});

	test('"." and " " missing from the legend are transparent and trimmed', () => {
		const { workspace, spriteId, layer } = setup();
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 0,
			y: 0,
			legend: { R: "#ff0000" },
			rows: [".R", " R"],
		});
		const cel = layer.cels.get(0);
		expect(cel?.data.x).toBe(1);
		expect(cel?.data.image.width).toBe(1);
		expect(cel?.data.image.height).toBe(2);
	});

	test('rows of only "." missing from the legend remove the cel', () => {
		const { workspace, spriteId, layer, sprite } = setup();
		setCel(sprite, layer, 0, {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend: { R: "#ff0000" },
			rows: ["."],
		});
		expect(layer.cels.size).toBe(0);
	});

	test("all-transparent rows remove the cel", () => {
		const { workspace, spriteId, layer, sprite } = setup();
		setCel(sprite, layer, 0, {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
		run(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["."],
		});
		expect(layer.cels.size).toBe(0);
	});

	test("an opacity change reports the cel's bounds", () => {
		const { workspace, spriteId, layer } = setup();
		const input = {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["R"],
		};
		run(workspace, input);
		const result = run(workspace, { ...input, opacity: 100 });
		expect(result.changed[0]?.rect).toEqual({
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		});
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
		const data = {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		};
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
		expect(result).toMatchObject({ cel: { x: 0, y: 0, width: 1, height: 1 } });
		expect(layer.cels.get(0)?.data).toBe(layer.cels.get(2)?.data);
	});

	describe("cel", () => {
		const target = { frame: 0 };

		test("is the whole new cel while changed is only the diff", () => {
			const { workspace, spriteId, layer } = setup();
			const input = { spriteId, layerId: layer.id, ...target, legend };
			run(workspace, { ...input, rows: ["RRRR", "RRRR", "RRRR"] });
			const result = run(workspace, {
				...input,
				rows: ["RRRR", "RRRR", "BBBB"],
			});
			expect(result.changed).toEqual([
				{
					layerId: layer.id,
					frame: 0,
					rect: { x: 0, y: 2, width: 4, height: 1 },
				},
			]);
			expect(result).toMatchObject({
				cel: { x: 0, y: 0, width: 4, height: 3 },
			});
		});

		test("is the trimmed bounds when the rows have transparent margins", () => {
			const { workspace, spriteId, layer } = setup();
			const result = run(workspace, {
				spriteId,
				layerId: layer.id,
				...target,
				legend,
				rows: ["....", ".R.R", "...."],
			});
			expect(result).toMatchObject({
				cel: { x: 1, y: 1, width: 3, height: 1 },
			});
		});

		test("keeps a negative x while changed is clipped to the canvas", () => {
			const { workspace, spriteId, layer } = setup();
			const result = run(workspace, {
				spriteId,
				layerId: layer.id,
				...target,
				x: -2,
				y: 1,
				legend,
				rows: ["RRRR"],
			});
			expect(result).toMatchObject({
				cel: { x: -2, y: 1, width: 4, height: 1 },
			});
			expect(result.changed).toEqual([
				{
					layerId: layer.id,
					frame: 0,
					rect: { x: 0, y: 1, width: 2, height: 1 },
				},
			]);
		});

		test("is null when transparent rows clear the cel", () => {
			const { workspace, spriteId, layer } = setup();
			const input = { spriteId, layerId: layer.id, ...target, legend };
			run(workspace, { ...input, rows: ["R"] });
			const result = run(workspace, { ...input, rows: ["."] });
			expect(result).toMatchObject({ cel: null });
			expect(layer.cels.has(0)).toBe(false);
		});

		test("is the whole canvas on a background layer", () => {
			const { workspace, spriteId, sprite } = setup();
			const background = createImageLayer({
				id: workspace.nextId("layer"),
				name: "BG",
				flags: { background: true },
			});
			addLayer(sprite, background, sprite.root, 0);
			const result = run(workspace, {
				spriteId,
				layerId: background.id,
				...target,
				x: 1,
				y: 1,
				legend,
				rows: ["R"],
			});
			expect(result).toMatchObject({
				cel: { x: 0, y: 0, width: 4, height: 4 },
			});
		});
	});
});
