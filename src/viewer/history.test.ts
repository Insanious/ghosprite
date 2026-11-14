import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { decodePng } from "../core/index.ts";
import { Session } from "../session.ts";
import { currentPath, renderSprites } from "./history.ts";

type Created = { spriteId: string; layerId: string };

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

describe("renderSprites", () => {
	test("a two frame sprite is one row with a gap", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 3,
			frameCount: 2,
		}) as unknown as Created;
		const { layerId } = session.run("layer.create", {
			spriteId,
			name: "L",
		}) as unknown as Created;
		paint(session, spriteId, layerId, 0, 1, "#ff0000");
		paint(session, spriteId, layerId, 1, 2, "#00ff00");
		const image = decode(
			renderSprites([session.workspace.getSprite(spriteId)]),
		);
		expect([image.width, image.height]).toEqual([9, 3]);
		expect(pixel(image, 1, 0)).toEqual([255, 0, 0, 255]);
		expect(pixel(image, 4, 0)[3]).toBe(0);
		expect(pixel(image, 5 + 2, 0)).toEqual([0, 255, 0, 255]);
	});

	test("sprites side by side share cells of the widest frame", () => {
		const session = new Session();
		const { results } = session.apply([
			{ op: "sprite.create", input: { width: 2, height: 2 } },
			{ op: "sprite.create", input: { width: 3, height: 2 } },
		]);
		const image = decode(
			renderSprites(
				results.map((result) =>
					session.workspace.getSprite((result as unknown as Created).spriteId),
				),
			),
		);
		expect([image.width, image.height]).toEqual([3 + 1 + 3, 2]);
	});
});

describe("currentPath", () => {
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
