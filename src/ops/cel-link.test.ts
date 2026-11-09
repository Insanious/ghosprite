import { describe, expect, test } from "bun:test";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { celLink } from "./cel-link.ts";
import { celSet } from "./cel-set.ts";
import { celUnlink } from "./cel-unlink.ts";
import { drawRect } from "./draw-rect.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry([celSet, celLink, celUnlink, drawRect]);
const legend = { R: "#ff0000" };

function setup() {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 4,
			height: 4,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({ id: workspace.nextId("layer"), name: "L" });
	addLayer(sprite, layer, sprite.root);
	const group = createGroupLayer({ id: workspace.nextId("layer"), name: "G" });
	addLayer(sprite, group, sprite.root);
	registry.callOp(workspace, "cel.set", {
		spriteId,
		layerId: layer.id,
		frame: 0,
		x: 1,
		y: 1,
		legend,
		rows: ["RR"],
	});
	return { workspace, spriteId, layer, group };
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

describe("cel.link and cel.unlink", () => {
	test("linking reports each frame that got a cel", () => {
		const { workspace, spriteId, layer } = setup();
		const result = registry.callOp(workspace, "cel.link", {
			spriteId,
			layerId: layer.id,
			frames: [0, 2],
		});
		expect(result).toMatchObject({
			changed: [
				{
					layerId: layer.id,
					frame: 2,
					rect: { x: 1, y: 1, width: 2, height: 1 },
				},
			],
		});
		expect(layer.cels.get(2)?.data).toBe(layer.cels.get(0)?.data);
	});

	test("a draw call on a linked frame reports both frames", () => {
		const { workspace, spriteId, layer } = setup();
		registry.callOp(workspace, "cel.link", {
			spriteId,
			layerId: layer.id,
			frames: [0, 1],
		});
		const result = registry.callOp(workspace, "draw.rect", {
			spriteId,
			layerId: layer.id,
			frame: 1,
			rect: { x: 0, y: 0, width: 1, height: 1 },
			filled: true,
			color: "#00ff00",
		}) as { changed: { frame: number }[] };
		expect(result.changed.map((c) => c.frame)).toEqual([0, 1]);
	});

	test("after unlinking, drawing on one frame leaves the other unchanged", () => {
		const { workspace, spriteId, layer } = setup();
		registry.callOp(workspace, "cel.link", {
			spriteId,
			layerId: layer.id,
			frames: [0, 1],
		});
		registry.callOp(workspace, "cel.unlink", {
			spriteId,
			layerId: layer.id,
			frame: 1,
		});
		registry.callOp(workspace, "draw.rect", {
			spriteId,
			layerId: layer.id,
			frame: 1,
			rect: { x: 0, y: 0, width: 1, height: 1 },
			filled: true,
			color: "#00ff00",
		});
		const frame0 = layer.cels.get(0)?.data;
		expect(frame0?.x).toBe(1);
		expect(Array.from(frame0?.image.data ?? [])).toEqual([
			255, 0, 0, 255, 255, 0, 0, 255,
		]);
		expect(layer.cels.get(1)?.data.x).toBe(0);
	});

	test("unlinking a cel that isn't linked changes nothing", () => {
		const { workspace, spriteId, layer } = setup();
		const data = layer.cels.get(0)?.data;
		registry.callOp(workspace, "cel.unlink", {
			spriteId,
			layerId: layer.id,
			frame: 0,
		});
		expect(layer.cels.get(0)?.data).toBe(data);
	});

	test("a group layer is rejected at layerId", () => {
		const { workspace, spriteId, group } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "cel.link", {
				spriteId,
				layerId: group.id,
				frames: [0, 1],
			}),
		);
		expect(error.path).toBe("layerId");
	});

	test("a frame past the end is rejected at frames.1", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "cel.link", {
				spriteId,
				layerId: layer.id,
				frames: [0, 3],
			}),
		);
		expect(error.path).toBe("frames.1");
	});

	test("fewer than 2 frames fails the schema", () => {
		const { workspace, spriteId, layer } = setup();
		const error = thrown(() =>
			registry.callOp(workspace, "cel.link", {
				spriteId,
				layerId: layer.id,
				frames: [0],
			}),
		);
		expect(error.code).toBe("invalid_input");
	});
});
