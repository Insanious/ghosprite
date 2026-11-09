import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { renderFrame } from "../core/render.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type LayerInit,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { celGet } from "./cel-get.ts";
import { celSet } from "./cel-set.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([celSet, celGet]);
const legend = {
	R: "#ff0000",
	G: "#00ff0080",
	B: "#0000ff",
};

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 8,
			height: 8,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const addImageLayer = (init: Partial<LayerInit> = {}) => {
		const layer = createImageLayer({
			id: workspace.nextId("layer"),
			name: "L",
			...init,
		});
		addLayer(sprite, layer, sprite.root);
		return layer;
	};
	return { workspace, spriteId, sprite, addImageLayer };
}

function set(workspace: Workspace, input: Record<string, unknown>) {
	return registry.callOp(workspace, "cel.set", input);
}

function get(workspace: Workspace, input: Record<string, unknown>) {
	return registry.callOp(workspace, "cel.get", input) as unknown as {
		x: number;
		y: number;
		width: number;
		height: number;
		opacity?: number;
		legend: Record<string, string>;
		rows: string[];
	};
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

describe("cel.get", () => {
	test("round trips a cel through cel.set onto another layer", () => {
		const { workspace, spriteId, sprite, addImageLayer } = setup();
		const a = addImageLayer();
		const b = addImageLayer();
		set(workspace, {
			spriteId,
			layerId: a.id,
			frame: 0,
			x: 2,
			y: 3,
			opacity: 128,
			legend,
			rows: ["RG.", ".GB", "B.R"],
		});
		const read = get(workspace, { spriteId, layerId: a.id, frame: 0 });
		expect(read).toMatchObject({
			x: 2,
			y: 3,
			width: 3,
			height: 3,
			opacity: 128,
		});
		set(workspace, { spriteId, layerId: b.id, frame: 0, ...read });
		const celA = a.cels.get(0);
		const celB = b.cels.get(0);
		expect(celB?.data.x).toBe(celA?.data.x);
		expect(celB?.data.y).toBe(celA?.data.y);
		expect(celB?.data.opacity).toBe(128);
		expect(celB?.data.image.width).toBe(celA?.data.image.width);
		expect(celB?.data.image.data).toEqual(celA?.data.image.data);
		expect(sprite.width).toBe(8);
	});

	test("reads raw pixels of a hidden multiply layer", () => {
		const { workspace, spriteId, addImageLayer } = setup();
		const layer = addImageLayer({ opacity: 100, flags: { visible: false } });
		layer.blendMode = "multiply";
		set(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["RB"],
		});
		const read = get(workspace, { spriteId, layerId: layer.id, frame: 0 });
		expect(read.rows).toEqual(["AB"]);
		expect(read.legend).toEqual({ A: "#ff0000", B: "#0000ff" });
	});

	test("a rect partly outside the cel reads transparent there", () => {
		const { workspace, spriteId, addImageLayer } = setup();
		const layer = addImageLayer();
		set(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 1,
			y: 1,
			legend,
			rows: ["RR", "RR"],
		});
		const rect = { x: 0, y: 0, width: 3, height: 3 };
		const read = get(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			rect,
		});
		expect(read).toMatchObject(rect);
		expect(read.rows).toEqual([".", ".AA", ".AA"]);
	});

	test("reads the composite of visible layers", () => {
		const { workspace, spriteId, sprite, addImageLayer } = setup();
		const bottom = addImageLayer();
		const top = addImageLayer();
		const hidden = addImageLayer({ flags: { visible: false } });
		set(workspace, {
			spriteId,
			layerId: bottom.id,
			frame: 0,
			legend,
			rows: ["RG"],
		});
		set(workspace, {
			spriteId,
			layerId: top.id,
			frame: 0,
			legend,
			rows: [".G"],
		});
		set(workspace, {
			spriteId,
			layerId: hidden.id,
			frame: 0,
			legend,
			rows: ["BB"],
		});

		const all = get(workspace, { spriteId, frame: 0 });
		expect(all).toMatchObject({ x: 0, y: 0, width: 8, height: 8 });
		expect(all.opacity).toBeUndefined();
		expect(all.rows).toHaveLength(8);

		const rendered = renderFrame(sprite, 0);
		const [r, g, b, a] = getPixel(rendered, 1, 0);
		const read = get(workspace, {
			spriteId,
			frame: 0,
			rect: { x: 1, y: 0, width: 1, height: 1 },
		});
		const hex = (n: number) => n.toString(16).padStart(2, "0");
		expect(read.legend).toEqual({ A: `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}` });
		expect(a).toBeGreaterThan(128);
		const first = get(workspace, {
			spriteId,
			frame: 0,
			rect: { x: 0, y: 0, width: 1, height: 1 },
		});
		expect(first.legend).toEqual({ A: "#ff0000" });
	});

	test("keeps the caller's characters between calls", () => {
		const { workspace, spriteId, addImageLayer } = setup();
		const layer = addImageLayer();
		set(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
			rows: ["RGB", "BGR"],
		});
		const first = get(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend,
		});
		expect(first.rows).toEqual(["RGB", "BGR"]);
		const edited = [
			first.rows[0]?.replace("B", "R") ?? "",
			first.rows[1] ?? "",
		];
		set(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend: first.legend,
			rows: edited,
		});
		const again = get(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			legend: first.legend,
		});
		expect(again.rows).toEqual(["RGR", "BGR"]);
		expect(again.legend).toEqual({
			R: "#ff0000",
			G: "#00ff0080",
			B: "#0000ff",
		});
	});

	test("rejects a group, a frame out of range, a missing cel and a large rect", () => {
		const { workspace, spriteId, sprite, addImageLayer } = setup();
		const layer = addImageLayer();
		const group = createGroupLayer({
			id: workspace.nextId("layer"),
			name: "G",
		});
		addLayer(sprite, group, sprite.root);

		expect(
			thrown(() => get(workspace, { spriteId, layerId: group.id, frame: 0 }))
				.code,
		).toBe("invalid_input");
		expect(
			thrown(() => get(workspace, { spriteId, layerId: layer.id, frame: 5 }))
				.code,
		).toBe("out_of_range");
		expect(thrown(() => get(workspace, { spriteId, frame: 5 })).code).toBe(
			"out_of_range",
		);
		const missing = thrown(() =>
			get(workspace, { spriteId, layerId: layer.id, frame: 0 }),
		);
		expect(missing.code).toBe("not_found");
		expect(missing.hint).toContain("rect");

		const big = thrown(() =>
			get(workspace, {
				spriteId,
				frame: 0,
				rect: { x: 0, y: 0, width: 129, height: 128 },
			}),
		);
		expect(big.code).toBe("out_of_range");
		expect(big.path).toBe("rect");
	});

	test("reads transparent from a layer with no cel when a rect is given", () => {
		const { workspace, spriteId, addImageLayer } = setup();
		const layer = addImageLayer();
		const read = get(workspace, {
			spriteId,
			layerId: layer.id,
			frame: 0,
			rect: { x: 0, y: 0, width: 2, height: 2 },
		});
		expect(read.rows).toEqual([".", "."]);
		expect(read.opacity).toBe(255);
	});
});
