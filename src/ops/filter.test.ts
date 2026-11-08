import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
} from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as {
		layerId: string;
		spriteId: string;
		changed: { frame: number }[];
	};
}

function failure(run: () => void): OpError {
	try {
		run();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

function setup(mode: "rgba" | "indexed" = "rgba") {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 4,
			height: 4,
			mode,
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: [100, 100, 100],
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({ id: workspace.nextId("layer"), name: "L" });
	addLayer(sprite, layer, sprite.root);
	const group = createGroupLayer({ id: workspace.nextId("layer"), name: "G" });
	addLayer(sprite, group, sprite.root);
	return { workspace, spriteId, layerId: layer.id, groupId: group.id };
}

function celPixel(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	frame: number,
) {
	const layer = workspace.getLayer(spriteId, layerId);
	if (layer.kind !== "image") throw new Error("Expected an image layer");
	const data = layer.cels.get(frame)?.data;
	return data && getPixel(data.image, 0, 0);
}

describe("filter runner", () => {
	test("a cel linked across frames is inverted once", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { R: "#ff0000" },
			rows: ["R"],
		});
		call(workspace, "cel.link", {
			spriteId,
			layerId,
			frames: [0, 1, 2],
		});
		const result = call(workspace, "filter.invert", {
			spriteId,
			layerId,
			frames: [0, 1, 2],
		});
		expect(celPixel(workspace, spriteId, layerId, 0)).toEqual([
			0, 255, 255, 255,
		]);
		expect(result.changed.map((entry) => entry.frame)).toEqual([0, 1, 2]);
	});

	test("a rows mask leaves the pixels under . unchanged", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { R: "#ff0000" },
			rows: ["RR"],
		});
		call(workspace, "filter.invert", {
			spriteId,
			layerId,
			frames: [0],
			mask: { x: 0, y: 0, rows: ["#."] },
		});
		const layer = workspace.getLayer(spriteId, layerId);
		if (layer.kind !== "image") throw new Error("Expected an image layer");
		const image = layer.cels.get(0)?.data.image;
		if (!image) throw new Error("Expected a cel");
		expect(getPixel(image, 0, 0)).toEqual([0, 255, 255, 255]);
		expect(getPixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
	});

	test("a frame with no cel is skipped", () => {
		const { workspace, spriteId, layerId } = setup();
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame: 1,
			legend: { R: "#ff0000" },
			rows: ["R"],
		});
		const result = call(workspace, "filter.invert", {
			spriteId,
			layerId,
			frames: [0, 1, 2],
		});
		expect(result.changed.map((entry) => entry.frame)).toEqual([1]);
	});

	test("a group layer is rejected", () => {
		const { workspace, spriteId, groupId } = setup();
		const error = failure(() =>
			call(workspace, "filter.invert", {
				spriteId,
				layerId: groupId,
				frames: [0],
			}),
		);
		expect(error.code).toBe("invalid_input");
	});

	test("a frame out of range is rejected", () => {
		const { workspace, spriteId, layerId } = setup();
		const error = failure(() =>
			call(workspace, "filter.invert", { spriteId, layerId, frames: [0, 3] }),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("frames.1");
	});

	test("an indexed sprite is rejected", () => {
		const { workspace, spriteId, layerId } = setup("indexed");
		const error = failure(() =>
			call(workspace, "filter.invert", { spriteId, layerId, frames: [0] }),
		);
		expect(error.code).toBe("unsupported");
	});
});
