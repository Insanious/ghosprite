import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { getPixel } from "../core/image.ts";
import { decodePng } from "../core/png.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as Record<string, unknown>;
}

function failure(run: () => unknown): OpError {
	try {
		run();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

type Sheet = {
	png: Uint8Array;
	frames: { frame: number; rect: { x: number; y: number } }[];
};

function setup(size = 2, frameCount = 2) {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width: size,
		height: size,
		frameCount,
	}) as { spriteId: string };
	const { layerId } = call(workspace, "layer.create", { spriteId }) as {
		layerId: string;
	};
	return { workspace, spriteId, layerId };
}

describe("sprite.contactSheet", () => {
	test("each rect holds its frame's pixels at scale 2 with a gap", () => {
		const { workspace, spriteId, layerId } = setup();
		const colors = ["#ff0000", "#00ff00"];
		for (const [frame, color] of colors.entries()) {
			call(workspace, "cel.set", {
				spriteId,
				layerId,
				frame,
				legend: { a: color },
				rows: ["aa", "aa"],
			});
		}
		const result = call(workspace, "sprite.contactSheet", {
			spriteId,
			scale: 2,
			gap: 3,
			columns: 2,
		}) as Sheet;
		const image = decodePng(result.png, inflateSync);
		expect([image.width, image.height]).toEqual([11, 4]);
		expect(result.frames.map((f) => f.rect.x)).toEqual([0, 7]);
		expect(getPixel(image, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(getPixel(image, 7, 3)).toEqual([0, 255, 0, 255]);
		expect(getPixel(image, 5, 0)[3]).toBe(0);
	});

	test("background fills the cells and the gap stays transparent", () => {
		const { workspace, spriteId } = setup();
		const result = call(workspace, "sprite.contactSheet", {
			spriteId,
			gap: 1,
			columns: 2,
			background: "#203040",
		}) as Sheet;
		const image = decodePng(result.png, inflateSync);
		expect(image.width).toBe(5);
		for (const x of [0, 1, 3, 4]) {
			expect(getPixel(image, x, 0)).toEqual([0x20, 0x30, 0x40, 255]);
		}
		expect(getPixel(image, 2, 0)[3]).toBe(0);
	});

	test("tag selects its frames", () => {
		const { workspace, spriteId } = setup(2, 3);
		call(workspace, "tag.create", { spriteId, name: "t", from: 1, to: 2 });
		const result = call(workspace, "sprite.contactSheet", {
			spriteId,
			tag: "t",
		}) as Sheet;
		expect(result.frames.map((f) => f.frame)).toEqual([1, 2]);
	});

	test("an unknown tag is not_found", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			call(workspace, "sprite.contactSheet", { spriteId, tag: "nope" }),
		);
		expect(error.code).toBe("not_found");
	});

	test("a frame past the end is out_of_range at frames.0", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			call(workspace, "sprite.contactSheet", { spriteId, frames: [5] }),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("frames.0");
	});

	test("frames and tag together are invalid_input", () => {
		const { workspace, spriteId } = setup();
		const error = failure(() =>
			call(workspace, "sprite.contactSheet", {
				spriteId,
				frames: [0],
				tag: "t",
			}),
		);
		expect(error.code).toBe("invalid_input");
	});

	test("a sheet over the pixel limit fails before rendering", () => {
		const { workspace, spriteId } = setup(64, 2);
		const error = failure(() =>
			call(workspace, "sprite.contactSheet", { spriteId, scale: 64 }),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("scale");
	});
});
