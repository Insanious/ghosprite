import { describe, expect, test } from "bun:test";
import { spriteWithLinkedCels } from "../../tests/helpers/linked-cels.ts";
import { Workspace } from "../workspace.ts";
import { createRegistry } from "./registry.ts";
import { spriteMapToPalette } from "./sprite-map-to-palette.ts";

const registry = createRegistry([spriteMapToPalette]);

describe("sprite.mapToPalette", () => {
	test("a cel linked across frames is converted once and reports each frame once", () => {
		const { sprite } = spriteWithLinkedCels();
		sprite.palettes = [
			{
				startFrame: 0,
				colors: [
					{ r: 0, g: 0, b: 0, a: 0 },
					{ r: 9, g: 8, b: 7, a: 255 },
				],
			},
		];
		const workspace = new Workspace();
		const spriteId = workspace.addSprite(sprite);
		const result = registry.callOp(workspace, "sprite.mapToPalette", {
			spriteId,
		});
		expect(result.changed.map((c) => c.frame).sort()).toEqual([0, 1]);
	});
});
