import { describe, expect, test } from "bun:test";
import { getPixel } from "../core/image.ts";
import { renderFrame } from "../core/render.ts";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";
import { getImageLayer } from "../target.ts";

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
	const layer = getImageLayer(session.workspace, spriteId, layerId);
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

function transform(
	op: "region.rotate" | "region.scale",
	session: Session,
	ids: { spriteId: string; layerId: string },
	selectionId: string,
	extra: object,
) {
	session.run(op, { ...ids, frames: [0], selectionId, ...extra });
}

function stored(session: Session, spriteId: string, selectionId: string) {
	const { bounds, bits } = session.workspace.getSelection(
		spriteId,
		selectionId,
	);
	return { bounds, bits: [...bits] };
}

describe("region.rotate", () => {
	for (const [name, width] of [
		["2x1", 2],
		["3x1", 3],
	] as const) {
		test(`four quarter turns restore a ${name} selection`, () => {
			const { session, spriteId, layerId } = setup();
			const ids = { spriteId, layerId };
			rect(session, ids, 0, [1, 2, 1, 1], "#ff0000");
			rect(session, ids, 0, [2, 2, 1, 1], "#0000ff");
			const selectionId = select(session, spriteId, {
				x: 1,
				y: 2,
				rows: ["1".repeat(width)],
			});
			const before = [
				...renderFrame(session.workspace.getSprite(spriteId), 0).data,
			];
			const selected = stored(session, spriteId, selectionId);
			for (let turn = 0; turn < 4; turn++) {
				transform("region.rotate", session, ids, selectionId, { angle: 90 });
			}
			expect([
				...renderFrame(session.workspace.getSprite(spriteId), 0).data,
			]).toEqual(before);
			expect(stored(session, spriteId, selectionId)).toEqual(selected);
		});
	}

	test("180 equals a horizontal and a vertical flip", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 1, 1], "#ff0000");
		rect(session, ids, 0, [3, 1, 1, 1], "#0000ff");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["111", "101"],
		});
		transform("region.rotate", session, ids, selectionId, { angle: -180 });
		expect(at(session, spriteId, layerId, 3, 2)).toEqual(RED);
		expect(at(session, spriteId, layerId, 1, 2)).toEqual(BLUE);
		expect(at(session, spriteId, layerId, 1, 1)).toEqual(CLEAR);
		expect(stored(session, spriteId, selectionId)).toEqual({
			bounds: { x: 1, y: 1, width: 3, height: 2 },
			bits: [1, 0, 1, 1, 1, 1],
		});
	});

	test("90 on a 3x1 selection lands centred", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 2, 1, 1], "#ff0000");
		rect(session, ids, 0, [3, 2, 1, 1], "#0000ff");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 2,
			rows: ["111"],
		});
		transform("region.rotate", session, ids, selectionId, { angle: 90 });
		expect(at(session, spriteId, layerId, 2, 1)).toEqual(RED);
		expect(at(session, spriteId, layerId, 2, 3)).toEqual(BLUE);
		expect(stored(session, spriteId, selectionId).bounds).toEqual({
			x: 2,
			y: 1,
			width: 1,
			height: 3,
		});
	});

	test("45 on a 1x1 selection keeps one pixel in place", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [2, 2, 1, 1], "#ff0000");
		const selectionId = select(session, spriteId, { x: 2, y: 2, rows: ["1"] });
		transform("region.rotate", session, ids, selectionId, { angle: 45 });
		expect(at(session, spriteId, layerId, 2, 2)).toEqual(RED);
		const { bounds, bits } = stored(session, spriteId, selectionId);
		expect(bounds).toEqual({ x: 2, y: 2, width: 1, height: 1 });
		expect(bits).toEqual([1]);
	});

	test("360 changes nothing", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 2, 1], "#ff0000");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["11"],
		});
		const before = [
			...renderFrame(session.workspace.getSprite(spriteId), 0).data,
		];
		const selected = stored(session, spriteId, selectionId);
		transform("region.rotate", session, ids, selectionId, { angle: 360 });
		expect([
			...renderFrame(session.workspace.getSprite(spriteId), 0).data,
		]).toEqual(before);
		expect(stored(session, spriteId, selectionId)).toEqual(selected);
	});
});

describe("region.scale", () => {
	test("scaling 2x3 to 4x6 doubles each pixel", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [0, 0, 1, 3], "#ff0000");
		rect(session, ids, 0, [1, 0, 1, 3], "#0000ff");
		const selectionId = select(session, spriteId, {
			x: 0,
			y: 0,
			rows: ["11", "11", "11"],
		});
		transform("region.scale", session, ids, selectionId, {
			width: 4,
			height: 6,
		});
		for (let y = 0; y < 6; y++) {
			expect(at(session, spriteId, layerId, 1, y)).toEqual(RED);
			expect(at(session, spriteId, layerId, 2, y)).toEqual(BLUE);
		}
		expect(stored(session, spriteId, selectionId)).toEqual({
			bounds: { x: 0, y: 0, width: 4, height: 6 },
			bits: new Array(24).fill(1),
		});
	});

	test("scaling to 1x1 keeps the top-left pixel", () => {
		const { session, spriteId, layerId } = setup();
		const ids = { spriteId, layerId };
		rect(session, ids, 0, [1, 1, 1, 1], "#ff0000");
		rect(session, ids, 0, [2, 1, 1, 1], "#0000ff");
		const selectionId = select(session, spriteId, {
			x: 1,
			y: 1,
			rows: ["11"],
		});
		transform("region.scale", session, ids, selectionId, {
			width: 1,
			height: 1,
		});
		expect(at(session, spriteId, layerId, 1, 1)).toEqual(RED);
		expect(at(session, spriteId, layerId, 2, 1)).toEqual(CLEAR);
		expect(stored(session, spriteId, selectionId)).toEqual({
			bounds: { x: 1, y: 1, width: 1, height: 1 },
			bits: [1],
		});
	});
});
