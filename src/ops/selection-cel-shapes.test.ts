import { describe, expect, test } from "bun:test";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";

const legend = { ".": "#00000000", "#": "#ff0000", s: "#ff000001" };

function setup() {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 6,
		height: 4,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as { layerId: string };
	session.run("cel.set", {
		spriteId,
		layerId,
		frame: 0,
		x: 1,
		y: 1,
		legend,
		rows: ["#s.", ".#."],
	});
	return { session, spriteId, layerId };
}

function select(session: Session, spriteId: string, shape: unknown) {
	return session.run("selection.create", { spriteId, shape }) as unknown as {
		bounds: { x: number; y: number; width: number; height: number };
		pixels: number;
	};
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

describe("content selection", () => {
	test("selects every pixel with alpha above 0, semi-transparent included", () => {
		const { session, spriteId, layerId } = setup();
		const result = select(session, spriteId, {
			content: { layerId, frame: 0 },
		});
		expect(result.pixels).toBe(3);
		expect(result.bounds).toEqual({ x: 1, y: 1, width: 2, height: 2 });
	});

	test("selects nothing on a frame with no cel", () => {
		const { session, spriteId, layerId } = setup();
		session.run("frame.create", { spriteId });
		const result = select(session, spriteId, {
			content: { layerId, frame: 1 },
		});
		expect(result.pixels).toBe(0);
	});
});

describe("cel shape errors", () => {
	test("a group layer fails at layerId", () => {
		const { session, spriteId } = setup();
		const { layerId: group } = session.run("layer.create", {
			spriteId,
			name: "G",
			group: true,
		}) as unknown as { layerId: string };
		const error = failure(() =>
			select(session, spriteId, { content: { layerId: group, frame: 0 } }),
		);
		expect(error.path).toBe("layerId");
	});

	test("a frame out of range fails at frame", () => {
		const { session, spriteId, layerId } = setup();
		const error = failure(() =>
			select(session, spriteId, {
				color: { layerId, frame: 5, color: "#ffffff" },
			}),
		);
		expect(error.path).toBe("frame");
	});

	test("a wand point outside the canvas fails at shape.wand.point", () => {
		const { session, spriteId, layerId } = setup();
		const error = failure(() =>
			select(session, spriteId, {
				wand: { layerId, frame: 0, point: { x: 6, y: 0 } },
			}),
		);
		expect(error.code).toBe("out_of_range");
		expect(error.path).toBe("shape.wand.point");
	});
});
