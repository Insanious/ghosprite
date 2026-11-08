import { describe, expect, test } from "bun:test";
import { OpError } from "../src/errors.ts";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import { Workspace } from "../src/workspace.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("shapes");

describe("draw.rect input", () => {
	test("a zero-width rect is rejected at rect.width", () => {
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
			registry.callOp(workspace, "draw.rect", {
				spriteId,
				layerId,
				frame: 0,
				color: "#000000",
				rect: { x: 0, y: 0, width: 0, height: 2 },
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).path).toBe("rect.width");
		}
	});
});
