import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { renderFrame } from "../core/render.ts";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

function setup(frames = 1) {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 6,
		height: 6,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as { layerId: string };
	for (let i = 1; i < frames; i++) session.run("frame.create", { spriteId });
	return { session, spriteId, layerId };
}

function rect(
	session: Session,
	ids: { spriteId: string; layerId: string },
	frame: number,
	box: [number, number, number, number],
	color: string,
) {
	const [x, y, width, height] = box;
	session.run("draw.rect", {
		...ids,
		frame,
		color,
		rect: { x, y, width, height },
		filled: true,
	});
}

function select(
	session: Session,
	spriteId: string,
	rows: { x: number; y: number; rows: string[] },
) {
	return (
		session.run("selection.create", {
			spriteId,
			shape: {
				...rows,
				rows: rows.rows.map((row) =>
					row.replaceAll("0", " ").replaceAll("1", "#"),
				),
			},
		}) as unknown as {
			selectionId: string;
		}
	).selectionId;
}

function cel(session: Session, spriteId: string, layerId: string, frame = 0) {
	const layer = session.workspace.getLayer(spriteId, layerId);
	if (layer.kind !== "image") throw new Error("Expected an image layer");
	return layer.cels.get(frame)?.data;
}

function at(
	session: Session,
	spriteId: string,
	layerId: string,
	x: number,
	y: number,
	frame = 0,
) {
	const data = cel(session, spriteId, layerId, frame);
	if (!data) return CLEAR;
	const px = x - data.x;
	const py = y - data.y;
	if (px < 0 || py < 0 || px >= data.image.width || py >= data.image.height) {
		return CLEAR;
	}
	return getPixel(data.image, px, py);
}

function failure(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

function move(
	session: Session,
	ids: { spriteId: string; layerId: string },
	selectionId: string,
	extra: object,
) {
	return session.run("region.move", {
		...ids,
		frames: [0],
		selectionId,
		...extra,
	}) as unknown as {
		changed: { frame: number }[];
		bounds: { x: number; y: number; width: number; height: number };
		pixels: number;
	};
}

describe("region.move", () => {
	test("moves pixels to the offset and clears the vacated ones", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 2, 1], "#ff0000");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["11"],
		});
		move(session, ids, selectionId, { dx: 2, dy: 1 });
		expect(at(session, spriteId, layerId, 1, 1)).toEqual(CLEAR);
		expect(at(session, spriteId, layerId, 2, 1)).toEqual(CLEAR);
		expect(at(session, spriteId, layerId, 3, 2)).toEqual(RED);
		expect(at(session, spriteId, layerId, 4, 2)).toEqual(RED);
	});

	test("leaves unselected pixels inside the selection's bounds", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 3, 1], "#ff0000");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["101"],
		});
		move(session, ids, selectionId, { dx: 0, dy: 2 });
		expect(at(session, spriteId, layerId, 2, 1)).toEqual(RED);
		expect(at(session, spriteId, layerId, 1, 1)).toEqual(CLEAR);
		expect(at(session, spriteId, layerId, 1, 3)).toEqual(RED);
		expect(at(session, spriteId, layerId, 2, 3)).toEqual(CLEAR);
		expect(at(session, spriteId, layerId, 3, 3)).toEqual(RED);
	});

	test("a selected transparent pixel overwrites what is at the destination", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [0, 0, 1, 1], "#ff0000");
		rect(session, ids, 0, [2, 0, 1, 1], "#0000ff");
		const selectionId = select(session, spriteId, {
			x: 0,
			y: 0,
			rows: ["01"],
		});
		move(session, ids, selectionId, { dx: 1, dy: 0 });
		expect(at(session, spriteId, layerId, 0, 0)).toEqual(RED);
		expect(at(session, spriteId, layerId, 1, 0)).toEqual(CLEAR);
		expect(at(session, spriteId, layerId, 2, 0)).toEqual(CLEAR);
	});

	test("keeps pixels moved off the canvas, and moving back restores them", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [4, 0, 2, 1], "#ff0000");
		const selectionId = select(session, spriteId, {
			x: 4,
			y: 0,
			rows: ["11"],
		});
		move(session, ids, selectionId, { dx: 3, dy: 0 });
		expect(at(session, spriteId, layerId, 7, 0)).toEqual(RED);
		expect(at(session, spriteId, layerId, 8, 0)).toEqual(RED);
		move(session, ids, selectionId, { dx: -3, dy: 0 });
		expect(at(session, spriteId, layerId, 4, 0)).toEqual(RED);
		expect(at(session, spriteId, layerId, 5, 0)).toEqual(RED);
		expect(at(session, spriteId, layerId, 7, 0)).toEqual(CLEAR);
	});

	test("a background layer needs a fill, which colours the vacated pixels", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		const layer = session.workspace.getLayer(spriteId, layerId);
		layer.flags.background = true;
		rect(session, ids, 0, [0, 0, 1, 1], "#ff0000");
		const selectionId = select(session, spriteId, { x: 0, y: 0, rows: ["1"] });
		const error = failure(() =>
			move(session, ids, selectionId, { dx: 1, dy: 0 }),
		);
		expect(error.path).toBe("fill");
		expect(error.code).toBe("unsupported");
		move(session, ids, selectionId, { dx: 1, dy: 0, fill: "#0000ff" });
		expect(at(session, spriteId, layerId, 0, 0)).toEqual(BLUE);
		expect(at(session, spriteId, layerId, 1, 0)).toEqual(RED);
	});

	test("moves linked cels once and reports every linked frame", () => {
		const { session, spriteId, layerId } = setup(3);
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [0, 0, 1, 1], "#ff0000");
		session.run("cel.link", { ...ids, frames: [0, 1] });
		const selectionId = select(session, spriteId, { x: 0, y: 0, rows: ["1"] });
		const result = move(session, ids, selectionId, {
			dx: 2,
			dy: 0,
			frames: [0, 1, 2],
		});
		expect(result.changed.map((c) => c.frame).sort()).toEqual([0, 1]);
		expect(at(session, spriteId, layerId, 2, 0, 0)).toEqual(RED);
		expect(at(session, spriteId, layerId, 2, 0, 1)).toEqual(RED);
		expect(at(session, spriteId, layerId, 0, 0, 1)).toEqual(CLEAR);
	});

	test("moves the stored selection by the same offset", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 2, 1], "#ff0000");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["11"],
		});
		const result = move(session, ids, selectionId, { dx: 2, dy: 3 });
		expect(result.bounds).toEqual({ x: 3, y: 4, width: 2, height: 1 });
		expect(result.pixels).toBe(2);
		const stored = session.workspace.getSelection(spriteId, selectionId);
		expect(stored.bounds).toEqual({ x: 3, y: 4, width: 2, height: 1 });
	});

	test("moves an empty selection's nothing and keeps it empty", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 1, 1], "#ff0000");
		const selectionId = select(session, spriteId, { x: 0, y: 0, rows: ["0"] });
		const result = move(session, ids, selectionId, { dx: 1, dy: 1 });
		expect(result.pixels).toBe(0);
		expect(result.changed).toEqual([]);
		expect(at(session, spriteId, layerId, 1, 1)).toEqual(RED);
	});

	test("undo restores both the pixels and the selection", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 1, 1], "#ff0000");
		const selectionId = select(session, spriteId, { x: 1, y: 1, rows: ["1"] });
		const before = [
			...renderFrame(session.workspace.getSprite(spriteId), 0).data,
		];
		move(session, ids, selectionId, { dx: 2, dy: 2 });
		session.undo();
		expect([
			...renderFrame(session.workspace.getSprite(spriteId), 0).data,
		]).toEqual(before);
		expect(
			session.workspace.getSelection(spriteId, selectionId).bounds,
		).toEqual({ x: 1, y: 1, width: 1, height: 1 });
	});
});
