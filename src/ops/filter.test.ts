import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { addLayer, createImageLayer, createSprite } from "../core/sprite.ts";
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

	test("a ragged rows mask leaves the padded area unchanged", () => {
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
			mask: { x: 0, y: 0, rows: ["#", "#"], width: 2 },
		});
		const layer = getImageLayer(workspace, spriteId, layerId);
		const image = layer.cels.get(0)?.data.image;
		if (!image) throw new Error("Expected a cel");
		expect(getPixel(image, 0, 0)).toEqual([0, 255, 255, 255]);
		expect(getPixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
	});
});
