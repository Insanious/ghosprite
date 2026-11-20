import { describe, expect, test } from "bun:test";
import {
	addLayer,
	createImageLayer,
	createSprite,
	getPixel,
} from "../core/index.ts";
import { OpError } from "../errors.ts";
import { getImageLayer } from "../target.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		layerId: string;
		spriteId: string;
		changed: { frame: number }[];
	};
}

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
	return { workspace, spriteId, layerId: layer.id };
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

describe("filter.replaceColor", () => {
	test("pairs light to dark and dark to light swap two yellows", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { L: "#ffee00", D: "#a08800", M: "#ff00ff" },
			rows: ["LDM"],
		});
		call(workspace, "filter.replaceColor", {
			spriteId,
			layerId,
			frames: [0],
			pairs: [
				{ from: "#ffee00", to: "#a08800" },
				{ from: "#a08800", to: "#ffee00" },
			],
		});
		const image = getImageLayer(workspace, spriteId, layerId).cels.get(0)?.data
			.image;
		if (!image) throw new Error("Expected a cel");
		expect(getPixel(image, 0, 0)).toEqual([160, 136, 0, 255]);
		expect(getPixel(image, 1, 0)).toEqual([255, 238, 0, 255]);
		expect(getPixel(image, 2, 0)).toEqual([255, 0, 255, 255]);
	});

	test("an empty pairs list is invalid_input", () => {
		const { workspace, spriteId, layerId } = setup();
		const error = thrown(() =>
			call(workspace, "filter.replaceColor", {
				spriteId,
				layerId,
				frames: [0],
				pairs: [],
			}),
		);
		expect(error.code).toBe("invalid_input");
	});

	test("a missing palette index names its pair", () => {
		const { workspace, spriteId, layerId } = setup();
		const error = thrown(() =>
			call(workspace, "filter.replaceColor", {
				spriteId,
				layerId,
				frames: [0],
				pairs: [
					{ from: "#ff0000", to: "#00ff00" },
					{ from: "#00ff00", to: { index: 9 } },
				],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "pairs.1.to",
		});
	});
});

describe("filter runner", () => {
	test("a rows mask leaves the pixels under . unchanged", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { R: "#ff0000" },
			rows: ["RR"],
		});
		call(workspace, "filter.invert", {
			spriteId,
			layerId,
			frames: [0],
			mask: { x: 0, y: 0, rows: ["#."] },
		});
		const layer = getImageLayer(workspace, spriteId, layerId);
		const image = layer.cels.get(0)?.data.image;
		if (!image) throw new Error("Expected a cel");
		expect(getPixel(image, 0, 0)).toEqual([0, 255, 255, 255]);
		expect(getPixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
	});
});
