import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expectSameSprite } from "../tests/helpers/undo.ts";
import {
	cloneSprite,
	encodePng,
	renderFrame,
	type Sprite,
	undoBytes,
} from "./core/index.ts";
import { OpError } from "./errors.ts";
import type { MutationResult } from "./ops/registry.ts";
import { type Call, type LogEntry, Session } from "./session.ts";

function pixelsOf(sprite: Sprite): string {
	return Buffer.from(encodePng(renderFrame(sprite, 0), deflateSync)).toString(
		"base64",
	);
}

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

	test("a resize that grows past the render limit fails at render.scale and keeps the old size", () => {
		const { session, spriteId } = setup();
		const error = thrown(() =>
			session.run("sprite.resize", {
				spriteId,
				width: 128,
				height: 128,
				render: { scale: 64 },
			}),
		);
		expect(error.toJSON()).toMatchObject({
			code: "out_of_range",
			path: "render.scale",
		});
		const sprite = session.workspace.getSprite(spriteId);
		expect([sprite.width, sprite.height]).toEqual([4, 4]);
	});

	test("a resize that shrinks under the render limit succeeds and returns its render", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 128,
			height: 128,
		}) as unknown as Created;
		const result = session.run("sprite.resize", {
			spriteId,
			width: 4,
			height: 4,
			render: { scale: 64 },
		}) as unknown as { render: { png: Uint8Array }[] };
		expect(result.render).toHaveLength(1);
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

	test("linked cels stay linked after undoing a draw on a linked sprite", () => {
		const { session, spriteId, layerId } = setup(2);
		draw(session, spriteId, layerId, 0, "#ff0000");
		session.run("cel.link", { spriteId, layerId, frames: [0, 1] });
		draw(session, spriteId, layerId, 1, "#00ff00");
		session.undo();
		draw(session, spriteId, layerId, 2, "#0000ff", 1);
		expect(render(session, spriteId, 0)).toBe(render(session, spriteId, 1));
	});

	test("a new step after an undo drops the redo steps", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		session.undo();
		draw(session, spriteId, layerId, 1, "#00ff00");
		expect(thrown(() => session.redo()).code).toBe("out_of_range");
	});

	test("undoing a sprite.load removes the loaded sprite and redo brings it back", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.load", {
			path: "tests/fixtures/sprites/groups3abc.aseprite",
		}) as unknown as Created;
		session.undo();
		expect(session.workspace.spriteIds()).toEqual([]);
		session.redo();
		expect(session.workspace.spriteIds()).toEqual([spriteId]);
	});

	test("an invalid op after a draw rolls the draw back and reports ops.1", () => {
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
				{ op: "draw.rect", input: { spriteId: 1 } },
			]),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("ops.1.spriteId");
		expect(render(session, spriteId)).toBe(blank);
	});

	test("a batch of only reads ops makes no step", () => {
		const { session, spriteId } = setup();
		const before = session.journal().length;
		const current = session.checkpoint("before-reads").checkpointId;
		const { results, checkpointId } = session.apply([
			{ op: "sprite.render", input: { spriteId } },
			{ op: "sprite.describe", input: { spriteId } },
		]);
		expect(results).toHaveLength(2);
		expect(checkpointId).toBe(current);
		expect(session.journal()).toHaveLength(before);
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

describe("Session checkpoints, restore and journal", () => {
	test("restore moves between named and numbered checkpoints", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const a = render(session, spriteId);
		session.checkpoint("a");
		const b = draw(session, spriteId, layerId, 1, "#00ff00");
		const withB = render(session, spriteId);
		session.restore("a");
		expect(render(session, spriteId)).toBe(a);
		session.restore(b.checkpointId as string);
		expect(render(session, spriteId)).toBe(withB);
	});

	test("a checkpoint on a dropped redo branch is not found", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const b = draw(session, spriteId, layerId, 1, "#00ff00");
		session.checkpoint("b");
		session.undo();
		draw(session, spriteId, layerId, 2, "#0000ff");
		const byName = thrown(() => session.restore("b"));
		expect(byName.code).toBe("not_found");
		expect(byName.path).toBe("checkpoint");
		expect(thrown(() => session.restore(b.checkpointId as string)).code).toBe(
			"not_found",
		);
	});

	test("the journal leaves out undone steps and replays to the same document", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		draw(session, spriteId, layerId, 1, "#00ff00");
		session.undo();
		session.apply(
			[
				{
					op: "draw.rect",
					input: {
						spriteId,
						layerId,
						frame: 0,
						rect: { x: 2, y: 0, width: 1, height: 1 },
						filled: true,
						color: "#0000ff",
					},
				},
				{ op: "sprite.render", input: { spriteId } },
			],
			"blue",
		);
		const journal = session.journal();
		expect(journal.map((c) => c.op)).toEqual([
			"sprite.create",
			"layer.create",
			"draw.rect",
			"session.apply",
		]);
		const applied = journal[3]?.input as { label?: string; ops: Call[] };
		expect(applied.label).toBe("blue");
		expect(applied.ops.length).toBe(1);

		const replay = new Session();
		for (const { op, input } of journal) {
			if (op === "session.apply") {
				const batch = input as { label?: string; ops: Call[] };
				replay.apply(batch.ops, batch.label);
			} else {
				replay.run(op, input);
			}
		}
		const dir = mkdtempSync(join(tmpdir(), "ghosprite-"));
		const saved = (s: Session, name: string) => {
			s.run("sprite.save", { spriteId, path: join(dir, name) });
			return readFileSync(join(dir, name));
		};
		expect(
			saved(replay, "b.aseprite").equals(saved(session, "a.aseprite")),
		).toBe(true);
	});

	test("notes and labels appear in the journal and replay without error", () => {
		const { session, spriteId, layerId } = setup();
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			rect: { x: 0, y: 0, width: 1, height: 1 },
			filled: true,
			color: "#ff0000",
			note: "helmet",
		});
		session.apply(
			[
				{
					op: "draw.rect",
					input: {
						spriteId,
						layerId,
						frame: 0,
						rect: { x: 1, y: 0, width: 1, height: 1 },
						filled: true,
						color: "#00ff00",
						note: "visor",
					},
				},
			],
			"shading",
		);
		const journal = session.journal();
		const single = journal[2]?.input as { note?: string };
		expect(single.note).toBe("helmet");
		const batch = journal[3]?.input as { label?: string; ops: Call[] };
		expect(batch.label).toBe("shading");
		const inner = batch.ops[0]?.input as { note?: string };
		expect(inner.note).toBe("visor");

		const replay = new Session();
		for (const { op, input } of journal) {
			if (op === "session.apply") {
				const b = input as { label?: string; ops: Call[] };
				replay.apply(b.ops, b.label);
			} else {
				replay.run(op, input);
			}
		}
		expect(replay.journal()).toEqual(journal);
	});

	test("the journal drops render keys and omits a missing label", () => {
		const session = new Session();
		session.run("sprite.create", {
			width: 1,
			height: 1,
			render: { frames: [0] },
		});
		session.apply([{ op: "sprite.create", input: { width: 1, height: 1 } }]);
		const [first, second] = session.journal();
		expect(first?.input).toEqual({ width: 1, height: 1 });
		expect(second?.input).toEqual({
			ops: [{ op: "sprite.create", input: { width: 1, height: 1 } }],
		});
	});

	test("spriteAt returns past pixels after later edits and after undo", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const a = pixelsOf(session.workspace.getSprite(spriteId));
		const { checkpointId } = session.checkpoint("a");
		draw(session, spriteId, layerId, 1, "#00ff00");
		expect(pixelsOf(session.spriteAt(checkpointId, spriteId))).toBe(a);
		session.undo(2);
		expect(pixelsOf(session.spriteAt("a", spriteId))).toBe(a);
	});

	test("spriteAt after a redo ignores the stale after-map", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const a = pixelsOf(session.workspace.getSprite(spriteId));
		session.checkpoint("a");
		draw(session, spriteId, layerId, 1, "#00ff00");
		session.undo();
		session.redo();
		expect(pixelsOf(session.spriteAt("a", spriteId))).toBe(a);
	});

	test("spriteAt throws when the sprite did not exist yet", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 1,
			height: 1,
		}) as unknown as Created;
		const error = thrown(() => session.spriteAt("checkpoint-0", spriteId));
		expect(error.code).toBe("not_found");
		expect(error.path).toBe("spriteId");
	});

	test("a checkpoint name that looks like an id is rejected", () => {
		const session = new Session();
		const error = thrown(() => session.checkpoint("checkpoint-3"));
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("name");
	});
});

describe("Session over the change log", () => {
	function pixel(spriteId: string, layerId: string, x: number, color: string) {
		return {
			op: "draw.rect",
			input: {
				spriteId,
				layerId,
				frame: 0,
				rect: { x, y: 0, width: 1, height: 1 },
				filled: true,
				color,
			},
		};
	}

	test("memory follows the change, not the sprite size", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 256,
			height: 256,
		}) as unknown as Created;
		const { layerId } = session.run("layer.create", {
			spriteId,
		}) as unknown as Created;
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			rect: { x: 0, y: 0, width: 256, height: 256 },
			filled: true,
			color: "#ff0000",
		});
		const sprite = session.workspace.getSprite(spriteId);
		const before = undoBytes(sprite);
		for (let x = 0; x < 10; x++) draw(session, spriteId, layerId, x, "#00ff00");
		expect(undoBytes(sprite) - before).toBeLessThan(1024);
	});

	test("a batch that edits two sprites is one step", () => {
		const a = setup();
		const b = a.session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as Created;
		const layerB = a.session.run("layer.create", {
			spriteId: b.spriteId,
		}) as unknown as Created;
		const blankA = cloneSprite(a.session.workspace.getSprite(a.spriteId));
		const blankB = cloneSprite(a.session.workspace.getSprite(b.spriteId));
		a.session.apply([
			pixel(a.spriteId, a.layerId, 0, "#ff0000"),
			pixel(b.spriteId, layerB.layerId, 1, "#00ff00"),
		]);
		const drawnA = cloneSprite(a.session.workspace.getSprite(a.spriteId));
		const drawnB = cloneSprite(a.session.workspace.getSprite(b.spriteId));
		a.session.undo();
		expectSameSprite(a.session.workspace.getSprite(a.spriteId), blankA);
		expectSameSprite(a.session.workspace.getSprite(b.spriteId), blankB);
		a.session.redo();
		expectSameSprite(a.session.workspace.getSprite(a.spriteId), drawnA);
		expectSameSprite(a.session.workspace.getSprite(b.spriteId), drawnB);
	});

	test("a batch that creates a sprite and draws on it survives undo and redo twice", () => {
		const session = new Session();
		session.apply([
			{ op: "sprite.create", input: { width: 4, height: 4 } },
			{ op: "layer.create", input: { spriteId: "sprite-1" } },
			pixel("sprite-1", "layer-1", 0, "#ff0000"),
		]);
		const drawn = pixelsOf(session.workspace.getSprite("sprite-1"));
		for (let i = 0; i < 2; i++) {
			session.undo();
			expect(session.workspace.spriteIds()).toEqual([]);
			session.redo();
		}
		expect(pixelsOf(session.workspace.getSprite("sprite-1"))).toBe(drawn);
	});

	test("a sprite edited only in a dropped step can be edited and undone again", () => {
		const a = setup();
		const b = a.session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as Created;
		const layerB = a.session.run("layer.create", {
			spriteId: b.spriteId,
		}) as unknown as Created;
		draw(a.session, b.spriteId, layerB.layerId, 0, "#ff0000");
		draw(a.session, b.spriteId, layerB.layerId, 1, "#00ff00");
		a.session.undo(2);
		draw(a.session, a.spriteId, a.layerId, 0, "#0000ff");
		const blankB = render(a.session, b.spriteId);
		draw(a.session, b.spriteId, layerB.layerId, 2, "#ffffff");
		a.session.undo();
		expect(render(a.session, b.spriteId)).toBe(blankB);
	});

	test("a failing op after a draw aborts the draw", () => {
		const { session, spriteId, layerId } = setup();
		const first = cloneSprite(session.workspace.getSprite(spriteId));
		thrown(() =>
			session.apply([
				pixel(spriteId, layerId, 0, "#ff0000"),
				{ op: "draw.rect", input: { spriteId: 1 } },
			]),
		);
		expectSameSprite(session.workspace.getSprite(spriteId), first);
	});

	test("redo still works after a batch that failed", () => {
		const { session, spriteId, layerId } = setup();
		draw(session, spriteId, layerId, 0, "#ff0000");
		const drawn = render(session, spriteId);
		session.undo();
		thrown(() =>
			session.apply([
				pixel(spriteId, layerId, 1, "#00ff00"),
				{ op: "draw.rect", input: { spriteId: 1 } },
			]),
		);
		session.redo();
		expect(render(session, spriteId)).toBe(drawn);
	});

	test("spriteAt an earlier checkpoint leaves the live state alone", () => {
		const { session, spriteId, layerId } = setup();
		const { checkpointId } = session.checkpoint("early");
		draw(session, spriteId, layerId, 0, "#ff0000");
		const live = session.workspace.getSprite(spriteId);
		const liveCopy = cloneSprite(live);
		const counters = session.workspace.counterSnapshot();
		const position = session.journal().length;
		const past = session.spriteAt(checkpointId, spriteId);
		expect(session.workspace.getSprite(spriteId)).toBe(live);
		expectSameSprite(live, liveCopy);
		expect(session.journal()).toHaveLength(position);
		expect(session.workspace.counterSnapshot()).toEqual(counters);
		const pastCopy = cloneSprite(past);
		draw(session, spriteId, layerId, 1, "#00ff00");
		expectSameSprite(past, pastCopy);
	});
});

describe("Session step log", () => {
	function noted(
		session: Session,
		spriteId: string,
		layerId: string,
		x: number,
		note: string,
	) {
		return session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			rect: { x, y: 0, width: 1, height: 1 },
			filled: true,
			color: "#ff0000",
			note,
		});
	}

	test("keeps undone steps and logs moves", () => {
		const { session, spriteId, layerId } = setup();
		noted(session, spriteId, layerId, 0, "a");
		noted(session, spriteId, layerId, 1, "b");
		noted(session, spriteId, layerId, 2, "c");
		session.undo(2);
		const { checkpointId } = draw(session, spriteId, layerId, 3, "#00ff00");
		const log = session.stepLog();
		expect(log).toHaveLength(7);
		expect(log.slice(0, 5).map((e) => e.checkpointId)).toEqual([
			"checkpoint-1",
			"checkpoint-2",
			"checkpoint-3",
			"checkpoint-4",
			"checkpoint-5",
		]);
		expect(log[0]).toMatchObject({
			kind: "step",
			op: "sprite.create",
			sprites: [spriteId],
		});
		expect(log[3]).toMatchObject({ op: "draw.rect", note: "b" });
		expect(log[4]).toMatchObject({ note: "c" });
		expect(log[5]).toEqual({ kind: "moved", checkpointId: "checkpoint-3" });
		expect(log[6]).toMatchObject({ kind: "step", checkpointId });
		expect(checkpointId).toBe("checkpoint-6");
	});

	test("logs one entry per move and none for no-ops", () => {
		const { session, spriteId, layerId } = setup();
		session.checkpoint("start");
		noted(session, spriteId, layerId, 0, "a");
		noted(session, spriteId, layerId, 1, "b");
		const base = session.stepLog().length;
		session.restore("start");
		expect(session.stepLog()).toHaveLength(base + 1);
		session.redo(2);
		expect(session.stepLog()).toHaveLength(base + 2);
		session.undo(2);
		expect(session.stepLog()).toHaveLength(base + 3);
		const after = session.stepLog();
		session.restore(session.checkpoint("here").checkpointId);
		expect(thrown(() => session.undo(9)).code).toBe("out_of_range");
		expect(thrown(() => session.restore("nope")).code).toBe("not_found");
		expect(session.stepLog()).toEqual(after);
	});

	test("spriteAt leaves the log unchanged", () => {
		const { session, spriteId, layerId } = setup();
		noted(session, spriteId, layerId, 0, "a");
		noted(session, spriteId, layerId, 1, "b");
		const before = session.stepLog();
		session.spriteAt("checkpoint-2", spriteId);
		expect(session.stepLog()).toEqual(before);
		session.undo(2);
		const afterUndo = session.stepLog();
		session.spriteAt("checkpoint-4", spriteId);
		expect(session.stepLog()).toEqual(afterUndo);
	});

	test("logs nothing for failed, read-only and all-reads calls", () => {
		const { session, spriteId } = setup();
		const before = session.stepLog();
		expect(() => session.run("draw.rect", { spriteId })).toThrow();
		expect(() =>
			session.apply([
				{ op: "sprite.create", input: { width: 1, height: 1 } },
				{ op: "nope", input: {} },
			]),
		).toThrow();
		session.run("sprite.render", { spriteId, frames: [0] });
		session.apply([{ op: "sprite.render", input: { spriteId, frames: [0] } }]);
		expect(session.stepLog()).toEqual(before);
	});

	test("a batch logs its label as note and every sprite it touched", () => {
		const { session, spriteId, layerId } = setup();
		const { checkpointId } = session.apply(
			[
				{ op: "sprite.create", input: { width: 2, height: 2 } },
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
			],
			"both",
		);
		const entry = session.stepLog().at(-1);
		expect(entry).toMatchObject({
			kind: "step",
			checkpointId,
			op: "session.apply",
			note: "both",
		});
		expect(entry).toHaveProperty("sprites", [
			expect.stringMatching(/^sprite-/),
			spriteId,
		]);
		draw(session, spriteId, layerId, 2, "#00ff00");
		expect(session.stepLog().at(-1)).not.toHaveProperty("note");
	});

	test("onLog fires once per log entry, in order, and not for anything else", () => {
		const seen: LogEntry[] = [];
		const session = new Session({ onLog: (entry) => seen.push(entry) });
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as Created;
		const { layerId } = session.run("layer.create", {
			spriteId,
			name: "L",
		}) as unknown as Created;
		expect(seen).toHaveLength(2);
		session.apply([
			{ op: "sprite.create", input: { width: 1, height: 1 } },
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
		]);
		expect(seen).toHaveLength(3);
		session.run("sprite.render", { spriteId, frames: [0] });
		expect(() => session.run("draw.rect", { spriteId })).toThrow();
		expect(seen).toHaveLength(3);
		session.undo();
		session.redo();
		session.restore("checkpoint-1");
		session.restore("checkpoint-1");
		expect(seen.slice(3)).toEqual([
			{ kind: "moved", checkpointId: "checkpoint-2" },
			{ kind: "moved", checkpointId: "checkpoint-3" },
			{ kind: "moved", checkpointId: "checkpoint-1" },
		]);
		expect(seen).toEqual(session.stepLog());
	});

	test("the returned log is a copy", () => {
		const { session } = setup();
		session.stepLog().length = 0;
		(session.stepLog()[0] as { op: string }).op = "x";
		expect(session.stepLog()).toHaveLength(2);
		expect(session.stepLog()[0]).toMatchObject({ op: "sprite.create" });
	});
});
