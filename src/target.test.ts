import { describe, expect, test } from "bun:test";
import {
	addLayer,
	createGroupLayer,
	createImageLayer,
	createSprite,
} from "./core/index.ts";
import { OpError } from "./errors.ts";
import {
	checkFrame,
	checkFrames,
	checkPoint,
	getImageLayer,
	resolveTarget,
	resolveTargetFrames,
} from "./target.ts";
import { Workspace } from "./workspace.ts";

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
			height: 3,
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
	return { workspace, spriteId, sprite, layerId: layer.id, groupId: group.id };
}

describe("getImageLayer", () => {
	test("returns an image layer", () => {
		const { workspace, spriteId, layerId } = setup();
		expect(getImageLayer(workspace, spriteId, layerId).id).toBe(layerId);
	});

	test("a group is invalid_input at layerId, or at the prefixed path", () => {
		const { workspace, spriteId, groupId } = setup();
		const plain = failure(() => getImageLayer(workspace, spriteId, groupId));
		expect(plain.code).toBe("invalid_input");
		expect(plain.path).toBe("layerId");
		const prefixed = failure(() =>
			getImageLayer(workspace, spriteId, groupId, "shape.wand.layerId"),
		);
		expect(prefixed.code).toBe("invalid_input");
		expect(prefixed.path).toBe("shape.wand.layerId");
	});

	test("a missing layer is not_found at the prefixed path", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			getImageLayer(workspace, spriteId, "nope", "shape.wand.layerId"),
		);
		expect(error.code).toBe("not_found");
		expect(error.path).toBe("shape.wand.layerId");
	});
});

describe("frame checks", () => {
	test("checkFrame accepts the last frame and rejects the next", () => {
		const { sprite } = setup();
		checkFrame(sprite, 2);
		const error = failure(() => checkFrame(sprite, 3));
		expect(error.code).toBe("out_of_range");
		expect(error.message).toBe("Frame 3 is outside 0..2");
		expect(error.path).toBe("frame");
	});

	test("checkFrames reports the first bad frame at its index", () => {
		const { sprite } = setup();
		expect(failure(() => checkFrames(sprite, [0, 5, 9])).path).toBe("frames.1");
		expect(
			failure(() => checkFrames(sprite, [0, 5, 9], "render.frames")).path,
		).toBe("render.frames.1");
	});
});

describe("checkPoint", () => {
	test("accepts the last pixel and rejects points outside", () => {
		const { sprite } = setup();
		checkPoint(sprite, { x: 3, y: 2 }, "point");
		for (const point of [
			{ x: 4, y: 0 },
			{ x: 0, y: 3 },
			{ x: -1, y: 0 },
		]) {
			const error = failure(() => checkPoint(sprite, point, "point"));
			expect(error.code).toBe("out_of_range");
			expect(error.path).toBe("point");
		}
		expect(failure(() => checkPoint(sprite, { x: 4, y: 0 }, "p")).message).toBe(
			"Point (4, 0) is outside the 4x3 canvas",
		);
	});
});

describe("resolveTarget", () => {
	test("returns the sprite and layer", () => {
		const { workspace, spriteId, layerId } = setup();
		const target = resolveTarget(workspace, spriteId, layerId, 2);
		expect(target.layer.id).toBe(layerId);
	});

	test("reports errors at the prefixed paths", () => {
		const { workspace, spriteId, layerId, groupId } = setup();
		expect(
			failure(() => resolveTarget(workspace, spriteId, groupId, 0, "a.")).path,
		).toBe("a.layerId");
		expect(
			failure(() => resolveTarget(workspace, spriteId, layerId, 3, "a.")).path,
		).toBe("a.frame");
	});

	test("rejects an indexed sprite as unsupported", () => {
		const { workspace, spriteId, layerId } = setup("indexed");
		expect(
			failure(() => resolveTarget(workspace, spriteId, layerId, 0)).code,
		).toBe("unsupported");
	});
});

describe("resolveTargetFrames", () => {
	test("checks every frame at frames.N", () => {
		const { workspace, spriteId, layerId } = setup();
		resolveTargetFrames(workspace, spriteId, layerId, [0, 2]);
		expect(
			failure(() => resolveTargetFrames(workspace, spriteId, layerId, [0, 3]))
				.path,
		).toBe("frames.1");
	});

	test("rejects an indexed sprite as unsupported", () => {
		const { workspace, spriteId, layerId } = setup("indexed");
		expect(
			failure(() => resolveTargetFrames(workspace, spriteId, layerId, [0]))
				.code,
		).toBe("unsupported");
	});

	test("an out-of-range frame on an indexed sprite is out_of_range, not unsupported", () => {
		const { workspace, spriteId, layerId } = setup("indexed");
		expect(
			failure(() => resolveTargetFrames(workspace, spriteId, layerId, [9]))
				.code,
		).toBe("out_of_range");
	});
});
