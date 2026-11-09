import { describe, expect, test } from "bun:test";
import { getPixel } from "../src/core/image.ts";
import { OpError } from "../src/errors.ts";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import { getImageLayer } from "../src/target.ts";
import { Workspace } from "../src/workspace.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("tiled-mask");

function setup() {
	const registry = createRegistry(operations);
	const workspace = new Workspace();
	const { spriteId } = registry.callOp(workspace, "sprite.create", {
		width: 8,
		height: 8,
	}) as unknown as { spriteId: string };
	const { layerId } = registry.callOp(workspace, "layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	const draw = (mask: unknown) =>
		registry.callOp(workspace, "draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			color: "#000000",
			rect: { x: 0, y: 0, width: 8, height: 8 },
			filled: true,
			mask,
		}) as unknown as { changed: unknown[] };
	return draw;
}

describe("draw masks", () => {
	test("a short mask row is padded with outside", () => {
		const registry = createRegistry(operations);
		const workspace = new Workspace();
		const { spriteId } = registry.callOp(workspace, "sprite.create", {
			width: 8,
			height: 8,
		}) as unknown as { spriteId: string };
		const { layerId } = registry.callOp(workspace, "layer.create", {
			spriteId,
		}) as unknown as { layerId: string };
		registry.callOp(workspace, "draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			color: "#000000",
			rect: { x: 0, y: 0, width: 8, height: 8 },
			filled: true,
			mask: { x: 0, y: 0, rows: ["###", "##"] },
		});
		const layer = getImageLayer(workspace, spriteId, layerId);
		const image = layer.cels.get(0)?.data.image;
		if (!image) throw new Error("Expected a cel");
		expect(getPixel(image, 1, 1)[3]).toBe(255);
		expect(getPixel(image, 2, 1)[3]).toBe(0);
	});

	test("a mask row longer than width is rejected at mask.rows.N", () => {
		const draw = setup();
		try {
			draw({ x: 0, y: 0, rows: ["##", "###"], width: 2 });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).path).toBe("mask.rows.1");
		}
	});

	test("a polygon mask with fewer than three points is rejected", () => {
		const draw = setup();
		expect(() =>
			draw({
				polygon: [
					{ x: 0, y: 0 },
					{ x: 3, y: 3 },
				],
			}),
		).toThrow(OpError);
	});

	test("a polygon mask outside the canvas draws nothing", () => {
		const draw = setup();
		const result = draw({
			polygon: [
				{ x: 20, y: 20 },
				{ x: 30, y: 20 },
				{ x: 25, y: 30 },
			],
		});
		expect(result.changed).toEqual([]);
	});

	test("a rows mask with no inside character draws nothing", () => {
		const draw = setup();
		expect(draw({ x: 0, y: 0, rows: ["   ", "   "] }).changed).toEqual([]);
	});

	test("a . in rows mask rows is outside, like a space", () => {
		const draw = setup();
		expect(draw({ x: 0, y: 0, rows: [".. ", " .."] }).changed).toEqual([]);
		const [change] = draw({ x: 2, y: 3, rows: ["#.", " ."] }).changed as {
			rect: unknown;
		}[];
		expect(change.rect).toEqual({ x: 2, y: 3, width: 1, height: 1 });
	});
});
