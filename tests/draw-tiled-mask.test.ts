import { describe, expect, test } from "bun:test";
import { OpError } from "../src/errors.ts";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
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
	test("uneven mask rows are rejected at mask.rows.N", () => {
		const draw = setup();
		try {
			draw({ x: 0, y: 0, rows: ["###", "##"] });
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
});
