import { describe, expect, test } from "bun:test";
import { renderFrame } from "../core/render.ts";
import { addLayer, createImageLayer, createSprite } from "../core/sprite.ts";
import { Workspace } from "../workspace.ts";
import { drawSpray } from "./draw-spray.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([drawSpray]);
const size = 64;

function spray(input: Record<string, unknown>): Uint8Array {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: size,
			height: size,
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
	registry.callOp(workspace, "draw.spray", {
		spriteId,
		layerId: layer.id,
		frame: 0,
		color: "#ff0000",
		...input,
	});
	return renderFrame(sprite, 0).data;
}

function painted(data: Uint8Array): { x: number; y: number }[] {
	const pixels = [];
	for (let i = 0; i < size * size; i++)
		if (data[i * 4 + 3] > 0)
			pixels.push({ x: i % size, y: Math.floor(i / size) });
	return pixels;
}

describe("draw.spray", () => {
	test("every painted pixel lies within the radius plus the brush radius of a point", () => {
		const points = [
			{ x: 16, y: 32 },
			{ x: 48, y: 32 },
		];
		const brushSize = 3;
		const radius = 6;
		const pixels = painted(
			spray({
				points,
				radius,
				count: 200,
				brush: { type: "circle", size: brushSize },
			}),
		);
		expect(pixels.length).toBeGreaterThan(0);
		const reach = radius + brushSize / 2 + 1;
		for (const pixel of pixels) {
			const nearest = Math.min(
				...points.map((p) => Math.hypot(pixel.x - p.x, pixel.y - p.y)),
			);
			expect(nearest).toBeLessThanOrEqual(reach);
		}
	});

	test("the same seed gives the same cel and another seed a different one", () => {
		const input = { points: [{ x: 32, y: 32 }], radius: 10, count: 50 };
		const first = spray({ ...input, seed: 1 });
		expect(spray({ ...input, seed: 1 })).toEqual(first);
		expect(spray({ ...input, seed: 2 })).not.toEqual(first);
	});

	test("count 1 with a size-1 brush paints at most one pixel per point", () => {
		const pixels = painted(
			spray({
				points: [
					{ x: 10, y: 10 },
					{ x: 50, y: 50 },
				],
				count: 1,
			}),
		);
		expect(pixels.length).toBeLessThanOrEqual(2);
		expect(pixels.length).toBeGreaterThan(0);
	});

	test("a spray under horizontal symmetry is its own left-right mirror", () => {
		const data = spray({
			points: [{ x: 20, y: 30 }],
			radius: 10,
			count: 60,
			symmetry: { mode: "horizontal", x: size / 2 },
		});
		const pixels = painted(data);
		expect(pixels.length).toBeGreaterThan(0);
		for (const { x, y } of pixels) {
			const mirrored = (y * size + (size - 1 - x)) * 4;
			expect(data[mirrored + 3]).toBeGreaterThan(0);
		}
	});
});
