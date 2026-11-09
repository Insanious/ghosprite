import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { addLayer, createImageLayer, createSprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { drawImage } from "./draw-image.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([drawImage]);

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 8,
			height: 8,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({
		id: workspace.nextId("layer"),
		name: "L",
	});
	addLayer(sprite, layer, sprite.root);
	return { workspace, spriteId, layer };
}

describe("draw.image", () => {
	test("a character missing from the legend fails at rows.N", () => {
		const { workspace, spriteId, layer } = setup();
		try {
			registry.callOp(workspace, "draw.image", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				x: 0,
				y: 0,
				legend: { r: "#ff0000" },
				rows: ["rr", "rx"],
			});
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).path).toBe("rows.1");
			return;
		}
		throw new Error("Expected an OpError");
	});

	test("a short first row does not move the image off x, y", () => {
		const { workspace, spriteId, layer } = setup();
		registry.callOp(workspace, "draw.image", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 2,
			y: 2,
			legend: { R: "#ff0000", G: "#00ff00" },
			rows: ["R", "..G"],
		});
		const image = layer.cels.get(0)?.data.image;
		const cel = layer.cels.get(0)?.data;
		expect(cel).toMatchObject({ x: 2, y: 2, image: { width: 3, height: 2 } });
		expect(image && getPixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(image && getPixel(image, 2, 1)).toEqual([0, 255, 0, 255]);
	});

	test("on a layer without a cel it creates one and reports the rows' rect", () => {
		const { workspace, spriteId, layer } = setup();
		const result = registry.callOp(workspace, "draw.image", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			x: 2,
			y: 3,
			legend: { r: "#ff0000", g: "#00ff00" },
			rows: ["rgr", "grg"],
		});
		expect(result.changed).toEqual([
			{
				layerId: layer.id,
				frame: 0,
				rect: { x: 2, y: 3, width: 3, height: 2 },
			},
		]);
		expect(result).toMatchObject({ cel: { x: 2, y: 3, width: 3, height: 2 } });
	});
});
