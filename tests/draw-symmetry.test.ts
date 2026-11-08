import { describe, expect, test } from "bun:test";
import { OpError } from "../src/errors.ts";
import { operations } from "../src/ops/index.ts";
import { createRegistry } from "../src/ops/registry.ts";
import { Workspace } from "../src/workspace.ts";
import { drawParity } from "./helpers/draw-parity.ts";

drawParity("symmetry");

describe("symmetry input", () => {
	test("an axis that is not a multiple of 0.5 is rejected at symmetry.x", () => {
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
			registry.callOp(workspace, "draw.line", {
				spriteId,
				layerId,
				frame: 0,
				color: "#000000",
				points: [{ x: 1, y: 1 }],
				symmetry: { mode: "horizontal", x: 3.25 },
			});
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).path).toBe("symmetry.x");
		}
	});
});
