import { describe, expect, test } from "bun:test";
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

	test("a . in rows mask rows is outside, like a space", () => {
		const draw = setup();
		expect(draw({ x: 0, y: 0, rows: [".. ", " .."] }).changed).toEqual([]);
		const [change] = draw({ x: 2, y: 3, rows: ["#.", " ."] }).changed as {
			rect: unknown;
		}[];
		expect(change.rect).toEqual({ x: 2, y: 3, width: 1, height: 1 });
	});
});
