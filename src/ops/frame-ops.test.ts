import { describe, expect, test } from "bun:test";
import { createImage } from "../core/image.ts";
import {
	addLayer,
	createImageLayer,
	createSprite,
	setCel,
} from "../core/sprite.ts";
import { createUserData } from "../core/user-data.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { frameCreate } from "./frame-create.ts";
import { frameDelete } from "./frame-delete.ts";
import { frameDuplicate } from "./frame-duplicate.ts";
import { createRegistry, type MutationResult } from "./registry.ts";

const base = createRegistry([frameCreate, frameDuplicate, frameDelete]);
const registry = {
	callOp: (workspace: Workspace, name: string, input: unknown) =>
		base.callOp(workspace, name, input) as MutationResult & { frame: number },
};

function setup(options: { background: boolean; frames?: number }) {
	const workspace = new Workspace();
	const spriteId = workspace.addSprite(
		createSprite({
			width: 3,
			height: 2,
			mode: "rgba",
			palettes: [{ startFrame: 0, colors: [] }],
			frameDurations: Array.from({ length: options.frames ?? 2 }, () => 100),
		}),
	);
	const sprite = workspace.getSprite(spriteId);
	const layer = createImageLayer({
		id: "bg",
		name: "bg",
		flags: { background: options.background },
	});
	addLayer(sprite, layer, sprite.root);
	return { workspace, spriteId, sprite, layer };
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

describe("frame.create", () => {
	test("without background on a background sprite is rejected at background", () => {
		const { workspace, spriteId } = setup({ background: true });
		const error = thrown(() =>
			registry.callOp(workspace, "frame.create", { spriteId }),
		);
		expect(error).toMatchObject({ code: "invalid_input", path: "background" });
		expect(error.hint).toBeDefined();
	});

	test("fills the background layer with an opaque cel", () => {
		const { workspace, spriteId, layer } = setup({ background: true });
		const result = registry.callOp(workspace, "frame.create", {
			spriteId,
			at: 1,
			background: "#10203040",
		});
		const cel = layer.cels.get(1);
		expect(cel?.data.image.width).toBe(3);
		expect(Array.from(cel?.data.image.data.slice(0, 4) ?? [])).toEqual([
			16, 32, 48, 255,
		]);
		expect(result.frame).toBe(1);
		expect(result.changed).toHaveLength(2);
	});

	test("ignores background when there is no background layer", () => {
		const { workspace, spriteId, layer, sprite } = setup({ background: false });
		registry.callOp(workspace, "frame.create", {
			spriteId,
			background: "#ffffff",
			duration: 40,
		});
		expect(layer.cels.size).toBe(0);
		expect(sprite.frameDurations).toEqual([100, 100, 40]);
	});

	test("rejects at past the frame count", () => {
		const { workspace, spriteId } = setup({ background: false });
		const error = thrown(() =>
			registry.callOp(workspace, "frame.create", { spriteId, at: 3 }),
		);
		expect(error).toMatchObject({ code: "out_of_range", path: "at" });
	});
});

describe("frame.duplicate and frame.delete", () => {
	test("duplicate reports every frame from the copy to the end", () => {
		const { workspace, spriteId, layer, sprite } = setup({
			background: false,
			frames: 3,
		});
		setCel(sprite, layer, 0, {
			image: createImage(1, 1, "rgba"),
			x: 0,
			y: 0,
			opacity: 255,
			userData: createUserData(),
		});
		const result = registry.callOp(workspace, "frame.duplicate", {
			spriteId,
			frame: 0,
		});
		expect(result.frame).toBe(1);
		expect(result.changed.map((c) => c.frame)).toEqual([1, 2, 3]);
	});

	test("deleting the only frame is out_of_range with a hint", () => {
		const { workspace, spriteId } = setup({ background: false, frames: 1 });
		const error = thrown(() =>
			registry.callOp(workspace, "frame.delete", { spriteId, frame: 0 }),
		);
		expect(error).toMatchObject({ code: "out_of_range", path: "frame" });
		expect(error.hint).toBeDefined();
	});

	test("delete reports from the deleted frame to the old last frame", () => {
		const { workspace, spriteId } = setup({ background: false, frames: 3 });
		const result = registry.callOp(workspace, "frame.delete", {
			spriteId,
			frame: 1,
		});
		expect(result.frame).toBe(1);
		expect(result.changed.map((c) => c.frame)).toEqual([1, 2]);
	});

	test("a frame past the end is out_of_range", () => {
		const { workspace, spriteId } = setup({ background: false });
		const error = thrown(() =>
			registry.callOp(workspace, "frame.duplicate", { spriteId, frame: 2 }),
		);
		expect(error).toMatchObject({ code: "out_of_range", path: "frame" });
	});
});
