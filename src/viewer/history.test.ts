import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { decodePng } from "../core/index.ts";
import { Session } from "../session.ts";
import { currentPath, StepPictures } from "./history.ts";

type Created = { spriteId: string; layerId: string };

function pictureSession() {
	const pictures = new StepPictures();
	const session = new Session({
		onLog: (entry, workspace) => pictures.record(entry, workspace),
	});
	return { session, pictures };
}

function paint(
	session: Session,
	spriteId: string,
	layerId: string,
	frame: number,
	x: number,
	color: string,
) {
	return session.run("draw.rect", {
		spriteId,
		layerId,
		frame,
		rect: { x, y: 0, width: 1, height: 1 },
		filled: true,
		color,
	}).checkpointId as string;
}

function pixel(
	image: { data: Uint8Array; width: number },
	x: number,
	y: number,
) {
	const at = (y * image.width + x) * 4;
	return [...image.data.subarray(at, at + 4)];
}

function decode(png: Uint8Array | undefined) {
	return decodePng(png as Uint8Array, inflateSync);
}

describe("StepPictures", () => {
	function twoFrameSprite(session: Session) {
		const sprite = session.run("sprite.create", {
			width: 4,
			height: 3,
			frameCount: 2,
		}) as unknown as Created;
		const { layerId } = session.run("layer.create", {
			spriteId: sprite.spriteId,
			name: "L",
		}) as unknown as Created;
		return { spriteId: sprite.spriteId, layerId };
	}

	test("a step on a two frame sprite is one row with a gap", () => {
		const { session, pictures } = pictureSession();
		const { spriteId, layerId } = twoFrameSprite(session);
		const first = paint(session, spriteId, layerId, 0, 1, "#ff0000");
		const image = decode(pictures.get(first));
		expect([image.width, image.height]).toEqual([9, 3]);
		expect(pixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
		expect(pixel(image, 5, 0)[3]).toBe(0);
		expect(pixel(image, 4, 0)[3]).toBe(0);

		const second = paint(session, spriteId, layerId, 1, 2, "#00ff00");
		const both = decode(pictures.get(second));
		expect(pixel(both, 1, 0)).toEqual([255, 0, 0, 255]);
		expect(pixel(both, 5 + 2, 0)).toEqual([0, 255, 0, 255]);
	});

	test("a step touching two sprites holds both", () => {
		const { session, pictures } = pictureSession();
		const { checkpointId } = session.apply([
			{ op: "sprite.create", input: { width: 2, height: 2 } },
			{ op: "sprite.create", input: { width: 3, height: 2 } },
		]);
		const image = decode(pictures.get(checkpointId));
		expect([image.width, image.height]).toEqual([3 + 1 + 3, 2]);
	});

	test("the picture keeps the sprite as it was at that step", () => {
		const { session, pictures } = pictureSession();
		const { spriteId, layerId } = twoFrameSprite(session);
		const first = paint(session, spriteId, layerId, 0, 1, "#ff0000");
		paint(session, spriteId, layerId, 0, 1, "#0000ff");
		expect(pixel(decode(pictures.get(first)), 1, 0)).toEqual([255, 0, 0, 255]);
	});

	test("a sprite over the render limit records no picture and the call succeeds", () => {
		const { session, pictures } = pictureSession();
		const result = session.run("sprite.create", {
			width: 4097,
			height: 4096,
			frameCount: 1,
		});
		expect(result.checkpointId).toBe("checkpoint-1");
		expect(pictures.get("checkpoint-1")).toBeUndefined();
	});

	test("a moved entry records no picture", () => {
		const { session, pictures } = pictureSession();
		session.run("sprite.create", { width: 2, height: 2 });
		session.undo();
		pictures.record(
			{ kind: "moved", checkpointId: "checkpoint-9" },
			session.workspace,
		);
		expect(pictures.get("checkpoint-9")).toBeUndefined();
		expect(pictures.get("checkpoint-0")).toBeUndefined();
	});

	test("an unknown checkpoint has no picture", () => {
		expect(new StepPictures().get("checkpoint-9")).toBeUndefined();
	});
});

describe("currentPath", () => {
	function steps() {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as Created;
		const { layerId } = session.run("layer.create", {
			spriteId,
			name: "L",
		}) as unknown as Created;
		return { session, spriteId, layerId };
	}

	test("linear steps are all on the path", () => {
		const { session, spriteId, layerId } = steps();
		paint(session, spriteId, layerId, 0, 0, "#ff0000");
		expect(currentPath(session.stepLog())).toEqual(
			new Set(["checkpoint-1", "checkpoint-2", "checkpoint-3"]),
		);
	});

	test("an undone step is off the path and redo puts it back", () => {
		const { session, spriteId, layerId } = steps();
		paint(session, spriteId, layerId, 0, 0, "#ff0000");
		session.undo();
		expect(currentPath(session.stepLog())).toEqual(
			new Set(["checkpoint-1", "checkpoint-2"]),
		);
		session.redo();
		expect(currentPath(session.stepLog())).toEqual(
			new Set(["checkpoint-1", "checkpoint-2", "checkpoint-3"]),
		);
	});

	test("an abandoned step stays off the path after a new step", () => {
		const { session, spriteId, layerId } = steps();
		paint(session, spriteId, layerId, 0, 0, "#ff0000");
		session.undo();
		const replacement = paint(session, spriteId, layerId, 0, 1, "#00ff00");
		const path = currentPath(session.stepLog());
		expect(path.has("checkpoint-3")).toBe(false);
		expect(path.has(replacement)).toBe(true);
		expect(path.size).toBe(3);
	});

	test("restoring to checkpoint-0 empties the path", () => {
		const { session, spriteId, layerId } = steps();
		paint(session, spriteId, layerId, 0, 0, "#ff0000");
		session.restore("checkpoint-0");
		expect(currentPath(session.stepLog())).toEqual(new Set());
	});
});
