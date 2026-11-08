import { describe, expect, test } from "bun:test";
import { renderFrame } from "../core/render.ts";
import { addLayer, createImageLayer, createSprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

const red = { r: 255, g: 0, b: 0, a: 255 };
const green = { r: 0, g: 255, b: 0, a: 255 };
const blue = { r: 0, g: 0, b: 255, a: 255 };

function setup(options: { background?: boolean } = {}) {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [
				{ startFrame: 0, colors: [red, green] },
				{ startFrame: 2, colors: [blue, red] },
			],
			frameDurations: [100, 100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({
		id: workspace.nextId("layer"),
		name: "L",
		flags: { background: options.background ?? false },
	});
	addLayer(sprite, layer, sprite.root);
	return { workspace, spriteId, sprite, layer };
}

function pixel(image: { data: Uint8Array }, x: number, y: number, width = 4) {
	const offset = (y * width + x) * 4;
	const [r = 0, g = 0, b = 0, a = 0] = image.data.subarray(offset, offset + 4);
	return { r, g, b, a };
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

describe("{index} colours", () => {
	test("draw.line paints the palette's second colour", () => {
		const { workspace, spriteId, sprite, layer } = setup();
		registry.callOp(workspace, "draw.line", {
			spriteId,
			layerId: layer.id,
			frame: 0,
			color: { index: 1 },
			points: [{ x: 0, y: 0 }],
		});
		expect(pixel(renderFrame(sprite, 0), 0, 0)).toEqual(green);
	});

	test("the palette in effect at the frame decides the colour", () => {
		const { workspace, spriteId, sprite, layer } = setup();
		for (const frame of [1, 3]) {
			registry.callOp(workspace, "draw.line", {
				spriteId,
				layerId: layer.id,
				frame,
				color: { index: 0 },
				points: [{ x: 0, y: 0 }],
			});
		}
		expect(pixel(renderFrame(sprite, 1), 0, 0)).toEqual(red);
		expect(pixel(renderFrame(sprite, 3), 0, 0)).toEqual(blue);
	});

	test("frame.create background uses the palette at the new frame", () => {
		const { workspace, spriteId, sprite } = setup({ background: true });
		registry.callOp(workspace, "frame.create", {
			spriteId,
			at: 3,
			background: { index: 0 },
		});
		expect(pixel(renderFrame(sprite, 3), 0, 0)).toEqual(blue);
	});

	test("an index past the palette fails on the colour's path", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "cel.set", {
				spriteId,
				layerId: layer.id,
				frame: 0,
				legend: { a: { index: 2 } },
				rows: ["a"],
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "legend.a",
		});
		expect(error.hint).toContain("2 colours");
	});

	test("palette.set can reorder the current palette", () => {
		const { workspace, spriteId, sprite } = setup();
		registry.callOp(workspace, "palette.set", {
			spriteId,
			colors: [{ index: 1 }, { index: 0 }],
		});
		expect(sprite.palettes[0]?.colors).toEqual([green, red]);
	});
});
