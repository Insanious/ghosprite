import { describe, expect, test } from "bun:test";
import { OpError } from "./errors.ts";
import type { MutationResult } from "./ops/registry.ts";
import { Session } from "./session.ts";

type Created = { spriteId: string; layerId: string };

function setup(frames = 1) {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 4,
		height: 4,
		frameCount: frames,
	}) as unknown as Created;
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as Created;
	return { session, spriteId, layerId };
}

function draw(
	session: Session,
	spriteId: string,
	layerId: string,
	x: number,
	color: string,
	frame = 0,
) {
	return session.run("draw.rect", {
		spriteId,
		layerId,
		frame,
		rect: { x, y: 0, width: 1, height: 1 },
		filled: true,
		color,
	});
}

function render(session: Session, spriteId: string, frame = 0): string {
	const result = session.run("sprite.render", {
		spriteId,
		frames: [frame],
	}) as unknown as { render: { png: Uint8Array }[] };
	return Buffer.from(result.render[0]?.png ?? []).toString("base64");
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

describe("Session undo and redo", () => {
	test("undo restores the blank sprite and redo the drawing", () => {
		const { session, spriteId, layerId } = setup();
		const blank = render(session, spriteId);
		draw(session, spriteId, layerId, 0, "#ff0000");
		const drawn = render(session, spriteId);
		expect(drawn).not.toBe(blank);
		session.undo();
		expect(render(session, spriteId)).toBe(blank);
		session.redo();
		expect(render(session, spriteId)).toBe(drawn);
	});

	test("undoing sprite.create removes the sprite and its id is reused", () => {
		const session = new Session();
		const first = session.run("sprite.create", { width: 1, height: 1 });
		expect(first.checkpointId).toBe("checkpoint-1");
		const move = session.undo();
		expect(move).toEqual({
			checkpointId: "checkpoint-0",
			sprites: ["sprite-1"],
		});
		expect(session.workspace.spriteIds()).toEqual([]);
		const again = session.run("sprite.create", {
			width: 1,
			height: 1,
		}) as MutationResult & Created;
		expect(again.spriteId).toBe("sprite-1");
		expect(again.checkpointId).toBe("checkpoint-2");
	});

	test("undoing a create-and-edit batch removes the sprite", () => {
		const session = new Session();
		const { results } = session.apply([
			{ op: "sprite.create", input: { width: 2, height: 2 } },
			{ op: "layer.create", input: { spriteId: "sprite-1" } },
		]);
		expect(results).toHaveLength(2);
		session.undo();
		expect(session.workspace.spriteIds()).toEqual([]);
	});

	test("a failing call rolls the batch back and prefixes the path", () => {
		const { session, spriteId, layerId } = setup();
		const blank = render(session, spriteId);
		const error = thrown(() =>
			session.apply([
				{
					op: "draw.rect",
					input: {
						spriteId,
						layerId,
						frame: 0,
						rect: { x: 0, y: 0, width: 1, height: 1 },
						filled: true,
						color: "#ff0000",
					},
				},
				{
					op: "draw.rect",
					input: {
						spriteId,
						layerId: "nope",
						frame: 0,
						rect: { x: 0, y: 0, width: 1, height: 1 },
						color: "#ff0000",
					},
				},
			]),
		);
		expect(error.path).toBe("ops.1.layerId");
		expect(render(session, spriteId)).toBe(blank);
		session.undo(2);
		expect(thrown(() => session.undo()).code).toBe("out_of_range");
	});

	test("a rolled back batch removes sprites it created and restores counters", () => {
		const session = new Session();
		thrown(() =>
			session.apply([
				{ op: "sprite.create", input: { width: 1, height: 1 } },
				{ op: "layer.create", input: { spriteId: "missing" } },
			]),
		);
		expect(session.workspace.spriteIds()).toEqual([]);
		const created = session.run("sprite.create", {
			width: 1,
			height: 1,
		}) as MutationResult & Created;
		expect(created.spriteId).toBe("sprite-1");
	});

	test("an unknown op gives the bare ops path", () => {
		const session = new Session();
		const error = thrown(() =>
			session.apply([
				{ op: "sprite.create", input: { width: 1, height: 1 } },
				{ op: "nope.nope", input: {} },
			]),
		);
		expect(error.code).toBe("unknown_op");
		expect(error.path).toBe("ops.1");
		expect(error.hint).toBeDefined();
	});

	test("a failing single run is not prefixed", () => {
		const session = new Session();
		const error = thrown(() => session.run("layer.create", { spriteId: "x" }));
		expect(error.path).toBe("spriteId");
	});

	test("linked cels stay linked across undo and redo", () => {
		const { session, spriteId, layerId } = setup(2);
		draw(session, spriteId, layerId, 0, "#ff0000");
		session.run("cel.link", { spriteId, layerId, frames: [0, 1] });
		session.undo();
		session.redo();
		draw(session, spriteId, layerId, 1, "#00ff00", 1);
		expect(render(session, spriteId, 0)).toBe(render(session, spriteId, 1));
	});

	test("a new step after an undo drops the redo steps", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		session.undo();
		draw(session, spriteId, layerId, 1, "#00ff00");
		expect(thrown(() => session.redo()).code).toBe("out_of_range");
	});

	test("a read-only op makes no step", () => {
		const { session, spriteId, layerId } = setup();
		const blank = render(session, spriteId);
		draw(session, spriteId, layerId, 0, "#ff0000");
		const rendered = session.run("sprite.render", { spriteId });
		expect(rendered.checkpointId).toBeUndefined();
		session.undo();
		expect(render(session, spriteId)).toBe(blank);
	});

	test("later edits never mutate a stored snapshot", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const a = render(session, spriteId);
		session.undo();
		session.redo();
		draw(session, spriteId, layerId, 1, "#00ff00");
		session.undo(2);
		session.redo();
		expect(render(session, spriteId)).toBe(a);
	});
});
