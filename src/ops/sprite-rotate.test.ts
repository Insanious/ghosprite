import { describe, expect, test } from "bun:test";
import { copyImage, imageLayers } from "../core/index.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		layerId: string;
		spriteId: string;
		changed: unknown[];
	};
}

function spriteWithCel() {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width: 5,
		height: 3,
	});
	const { layerId } = call(workspace, "layer.create", { spriteId, name: "a" });
	call(workspace, "cel.set", {
		spriteId,
		layerId,
		frame: 0,
		x: 1,
		y: 0,
		legend: { a: "#ff0000", b: "#00ff00", c: "#0000ff" },
		rows: ["abc", "cba"],
	});
	return { workspace, spriteId };
}

function snapshot(workspace: Workspace, spriteId: string) {
	const sprite = workspace.getSprite(spriteId);
	const cels = imageLayers(sprite.root).flatMap((layer) =>
		[...layer.cels.values()].map((cel) => ({
			x: cel.data.x,
			y: cel.data.y,
			image: copyImage(cel.data.image),
		})),
	);
	return { width: sprite.width, height: sprite.height, cels };
}

describe("sprite.rotate and sprite.flip", () => {
	test("rotating 90 four times restores the sprite", () => {
		const { workspace, spriteId } = spriteWithCel();
		const before = snapshot(workspace, spriteId);
		for (let i = 0; i < 4; i++) {
			call(workspace, "sprite.rotate", { spriteId, angle: 90 });
		}
		expect(snapshot(workspace, spriteId)).toEqual(before);
	});

	test("rotating 90 swaps the canvas size", () => {
		const { workspace, spriteId } = spriteWithCel();
		call(workspace, "sprite.rotate", { spriteId, angle: 90 });
		const after = snapshot(workspace, spriteId);
		expect([after.width, after.height]).toEqual([3, 5]);
	});

	test("flipping twice restores the sprite", () => {
		const { workspace, spriteId } = spriteWithCel();
		const before = snapshot(workspace, spriteId);
		for (const direction of [
			"horizontal",
			"horizontal",
			"vertical",
			"vertical",
		]) {
			call(workspace, "sprite.flip", { spriteId, direction });
		}
		expect(snapshot(workspace, spriteId)).toEqual(before);
	});

	test("an angle other than 90, 180 or 270 is rejected", () => {
		const { workspace, spriteId } = spriteWithCel();
		expect(() =>
			call(workspace, "sprite.rotate", { spriteId, angle: 45 }),
		).toThrow();
	});
});
