import { describe, expect, test } from "bun:test";
import { OpError } from "../src/errors.ts";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import { Workspace } from "../src/workspace.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("fill");

describe("draw.fill eraser", () => {
	test("erases the filled area, which Aseprite's paint bucket can't record", () => {
		const registry = createRegistry(operations);
		const workspace = new Workspace();
		const { spriteId } = registry.callOp(workspace, "sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as { spriteId: string };
		const { layerId } = registry.callOp(workspace, "layer.create", {
			spriteId,
		}) as unknown as { layerId: string };
		const target = { spriteId, layerId, frame: 0, point: { x: 0, y: 0 } };
		registry.callOp(workspace, "draw.fill", { ...target, color: "#ff0000" });
		registry.callOp(workspace, "draw.fill", { ...target, ink: "eraser" });
		const layer = workspace.getLayer(spriteId, layerId);
		if (layer.kind !== "image") throw new Error("Expected an image layer");
		const data = layer.cels.get(0)?.data;
		expect(data === undefined || data.image.data.every((v) => v === 0)).toBe(
			true,
		);
	});
});

describe("draw.fill input", () => {
	for (const tiled of [undefined, "both"] as const) {
		test(`a point outside the canvas is out_of_range at point${tiled ? " in tiled mode" : ""}`, () => {
			const registry = createRegistry(operations);
			const workspace = new Workspace();
			const { spriteId } = registry.callOp(workspace, "sprite.create", {
				width: 8,
				height: 8,
			}) as unknown as { spriteId: string };
			const { layerId } = registry.callOp(workspace, "layer.create", {
				spriteId,
			}) as unknown as { layerId: string };
			try {
				registry.callOp(workspace, "draw.fill", {
					spriteId,
					layerId,
					frame: 0,
					color: "#000000",
					point: { x: 8, y: 0 },
					tiled,
				});
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(OpError);
				expect((error as OpError).code).toBe("out_of_range");
				expect((error as OpError).path).toBe("point");
			}
		});
	}
});
