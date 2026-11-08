import { describe, expect, test } from "bun:test";
import { renderFrame } from "../core/render.ts";
import { OpError } from "../errors.ts";
import { type Call, Session } from "../session.ts";

type Ids = { spriteId: string; layerId: string; selectionId: string };

function setup() {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 6,
		height: 6,
	}) as unknown as Ids;
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as Ids;
	return { session, spriteId, layerId };
}

function pixels(session: Session, spriteId: string): number[] {
	return [...renderFrame(session.workspace.getSprite(spriteId), 0).data];
}

function run(session: Session, op: string, input: unknown) {
	return session.run(op, input) as Record<string, unknown>;
}

function failure(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected an OpError");
}

const rowsShape = { x: 3, y: 2, rows: ["  ", " #", " #", "  "] };

describe("selection ops", () => {
	test("the first create returns selection-1 with trimmed bounds", () => {
		const { session, spriteId } = setup();
		const result = run(session, "selection.create", {
			spriteId,
			shape: rowsShape,
		});
		expect(result).toMatchObject({
			selectionId: "selection-1",
			bounds: { x: 4, y: 3, width: 1, height: 2 },
			pixels: 2,
		});
	});

	test("a . in rows shape rows is outside, like a space", () => {
		const { session, spriteId } = setup();
		const result = run(session, "selection.create", {
			spriteId,
			shape: { x: 3, y: 2, rows: [".#", " #"] },
		});
		expect(result).toMatchObject({
			bounds: { x: 4, y: 2, width: 1, height: 2 },
			pixels: 2,
		});
	});

	test("all selects the canvas and ellipse an inscribed ellipse", () => {
		const { session, spriteId } = setup();
		expect(
			run(session, "selection.create", { spriteId, shape: { all: true } })
				.pixels,
		).toBe(36);
		expect(
			run(session, "selection.create", {
				spriteId,
				shape: { ellipse: { x: 0, y: 0, width: 1, height: 1 } },
			}).pixels,
		).toBe(1);
	});

	test("subtract shrinks the pixel count, also from itself", () => {
		const { session, spriteId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 0, y: 0, width: 3, height: 3 } },
		}) as unknown as Ids;
		const shrunk = run(session, "selection.combine", {
			spriteId,
			selectionId,
			shape: { rect: { x: 0, y: 0, width: 1, height: 3 } },
			mode: "subtract",
		});
		expect(shrunk.pixels).toBe(6);
		const emptied = run(session, "selection.combine", {
			spriteId,
			selectionId,
			shape: { selectionId },
			mode: "subtract",
		});
		expect(emptied.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
		expect(emptied.pixels).toBe(0);
	});

	test("an unknown selectionId is not_found at the field that named it", () => {
		const { session, spriteId, layerId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { all: true },
		}) as unknown as Ids;
		const rect = { x: 0, y: 0, width: 1, height: 1 };
		const combine = failure(() =>
			session.run("selection.combine", {
				spriteId,
				selectionId: "selection-9",
				shape: { rect },
				mode: "add",
			}),
		);
		expect([combine.code, combine.path]).toEqual(["not_found", "selectionId"]);
		const shape = failure(() =>
			session.run("selection.combine", {
				spriteId,
				selectionId,
				shape: { selectionId: "selection-9" },
				mode: "add",
			}),
		);
		expect([shape.code, shape.path]).toEqual([
			"not_found",
			"shape.selectionId",
		]);
		const draw = failure(() =>
			session.run("draw.rect", {
				spriteId,
				layerId,
				frame: 0,
				rect,
				color: "#ff0000",
				mask: { selectionId: "selection-9" },
			}),
		);
		expect([draw.code, draw.path]).toEqual(["not_found", "mask.selectionId"]);
	});

	test("an empty selection as a mask leaves the cel unchanged", () => {
		const { session, spriteId, layerId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 0, y: 0, width: 1, height: 1 } },
		}) as unknown as Ids;
		session.run("selection.combine", {
			spriteId,
			selectionId,
			shape: { selectionId },
			mode: "subtract",
		});
		const before = pixels(session, spriteId);
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			rect: { x: 0, y: 0, width: 6, height: 6 },
			filled: true,
			color: "#ff0000",
			mask: { selectionId },
		});
		expect(pixels(session, spriteId)).toEqual(before);
	});

	test("a selection mask matches the same inline mask for draw and filter ops", () => {
		const inline = { x: 1, y: 1, rows: ["##", " #"] };
		const run = (mask: (selectionId: string) => unknown) => {
			const { session, spriteId, layerId } = setup();
			const { selectionId } = session.run("selection.create", {
				spriteId,
				shape: inline,
			}) as unknown as Ids;
			session.run("draw.rect", {
				spriteId,
				layerId,
				frame: 0,
				rect: { x: 0, y: 0, width: 6, height: 6 },
				filled: true,
				color: "#ff0000",
				mask: mask(selectionId),
			});
			session.run("filter.invert", {
				spriteId,
				layerId,
				frames: [0],
				mask: mask(selectionId),
			});
			return pixels(session, spriteId);
		};
		const viaSelection = run((selectionId) => ({ selectionId }));
		expect(viaSelection).toEqual(run(() => inline));
		expect(viaSelection.some((value) => value !== 0)).toBe(true);
	});
});

describe("selections in sessions", () => {
	const create: Call = {
		op: "selection.create",
		input: { spriteId: "sprite-1", shape: { all: true } },
	};

	test("undo removes a created selection and redo restores it", () => {
		const { session, spriteId } = setup();
		session.run(create.op, create.input);
		session.undo();
		expect(session.workspace.getSprite(spriteId).selections.size).toBe(0);
		session.redo();
		expect([
			...session.workspace.getSprite(spriteId).selections.keys(),
		]).toEqual(["selection-1"]);
	});

	test("delete removes the selection and undo brings it back", () => {
		const { session, spriteId } = setup();
		session.run(create.op, create.input);
		session.run("selection.delete", {
			spriteId,
			selectionId: "selection-1",
		});
		expect(session.workspace.getSprite(spriteId).selections.size).toBe(0);
		session.undo();
		expect(session.workspace.getSprite(spriteId).selections.size).toBe(1);
	});

	test("the journal replays to the same selections", () => {
		const { session, spriteId } = setup();
		session.run(create.op, create.input);
		session.run("selection.combine", {
			spriteId,
			selectionId: "selection-1",
			shape: { rect: { x: 0, y: 0, width: 2, height: 2 } },
			mode: "subtract",
		});
		const replay = new Session();
		for (const { op, input } of session.journal()) replay.run(op, input);
		expect(replay.workspace.getSprite(spriteId).selections).toEqual(
			session.workspace.getSprite(spriteId).selections,
		);
	});
});
