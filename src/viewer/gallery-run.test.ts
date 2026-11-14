import { afterAll, describe, expect, test } from "bun:test";
import {
	appendFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import { startRunLog } from "../run-log.ts";
import { Session } from "../session.ts";
import { GalleryRun } from "./gallery-run.ts";

const scratch = mkdtempSync(join(tmpdir(), "ghosprite-gallery-run-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;

function buildRun(build: (session: Session) => void): string {
	const runLog = startRunLog(join(scratch, `run-${counter++}`));
	build(new Session({ onLog: (entry) => runLog.append(entry) }));
	return runLog.folder;
}

function twoSprites(session: Session): void {
	session.run("sprite.create", { width: 4, height: 4 });
	session.run("sprite.create", { width: 6, height: 5 });
}

function pngSize(png: Uint8Array): { width: number; height: number } {
	const view = new DataView(png.buffer, png.byteOffset);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function rewriteLines(
	folder: string,
	change: (lines: string[]) => string[],
): void {
	const path = join(folder, "log.jsonl");
	const lines = readFileSync(path, "utf8").split("\n").slice(0, -1);
	writeFileSync(path, `${change(lines).join("\n")}\n`);
}

function breakStep(line: string | undefined, checkpointId: string): string {
	return JSON.stringify({ ...JSON.parse(line as string), checkpointId });
}

describe("GalleryRun", () => {
	test("two sprites give two pages that each hold only their own steps", () => {
		const folder = buildRun((session) => {
			twoSprites(session);
			session.run("layer.create", { spriteId: "sprite-1", name: "a" });
		});
		const run = new GalleryRun(folder);
		expect(run.sprites()).toEqual([
			{
				page: "checkpoint-1",
				spriteId: "sprite-1",
				width: 4,
				height: 4,
				thumbnail: "checkpoint-3",
				onPath: true,
			},
			{
				page: "checkpoint-2",
				spriteId: "sprite-2",
				width: 6,
				height: 5,
				thumbnail: "checkpoint-2",
				onPath: true,
			},
		]);
		expect(run.log("checkpoint-1")?.map((e) => e.checkpointId)).toEqual([
			"checkpoint-1",
			"checkpoint-3",
		]);
		expect(run.log("checkpoint-2")?.map((e) => e.checkpointId)).toEqual([
			"checkpoint-2",
		]);
		expect(run.log("checkpoint-9")).toBeUndefined();
		expect(run.picture("checkpoint-1", "checkpoint-1")).toBeDefined();
		expect(run.picture("checkpoint-2", "checkpoint-3")).toBeUndefined();
	});

	test("an undone creation and a new one with the same id are two pages", () => {
		const folder = buildRun((session) => {
			session.run("sprite.create", { width: 4, height: 4 });
			session.run("sprite.create", { width: 6, height: 5 });
			session.undo();
			session.run("sprite.create", { width: 2, height: 3 });
		});
		const sprites = new GalleryRun(folder).sprites();
		expect(
			sprites.map((s) => [s.page, s.spriteId, s.thumbnail, s.onPath]),
		).toEqual([
			["checkpoint-1", "sprite-1", "checkpoint-1", true],
			["checkpoint-2", "sprite-2", "checkpoint-2", false],
			["checkpoint-3", "sprite-2", "checkpoint-3", true],
		]);
	});

	test("a batch on both sprites is on both pages, with its own picture each", () => {
		const folder = buildRun((session) => {
			twoSprites(session);
			session.apply([
				{ op: "layer.create", input: { spriteId: "sprite-1", name: "a" } },
				{ op: "layer.create", input: { spriteId: "sprite-2", name: "b" } },
			]);
		});
		const run = new GalleryRun(folder);
		const first = run.log("checkpoint-1")?.at(-1);
		const second = run.log("checkpoint-2")?.at(-1);
		expect(first).toMatchObject({ checkpointId: "checkpoint-3" });
		expect(first && "others" in first && first.others).toEqual(["sprite-2"]);
		expect(second && "others" in second && second.others).toEqual(["sprite-1"]);
		expect(run.log("checkpoint-1")?.[0]).not.toHaveProperty("others");
		const one = run.picture("checkpoint-1", "checkpoint-3") as Uint8Array;
		const two = run.picture("checkpoint-2", "checkpoint-3") as Uint8Array;
		expect(pngSize(one)).toEqual({ width: 4, height: 4 });
		expect(pngSize(two)).toEqual({ width: 6, height: 5 });
	});

	test("every page carries the moves, and an undone step is off the path", () => {
		const folder = buildRun((session) => {
			twoSprites(session);
			session.run("layer.create", { spriteId: "sprite-1", name: "a" });
			session.undo();
		});
		const run = new GalleryRun(folder);
		for (const page of ["checkpoint-1", "checkpoint-2"]) {
			expect(run.log(page)?.some((e) => e.kind === "moved")).toBe(true);
		}
		const items = run.log("checkpoint-1") ?? [];
		expect(
			items.flatMap((e) =>
				e.kind === "step" ? [[e.checkpointId, e.onPath, e.current]] : [],
			),
		).toEqual([
			["checkpoint-1", true, true],
			["checkpoint-3", false, false],
		]);
	});

	test("later lines are picked up and a half-written line waits", () => {
		const path = join(
			buildRun((session) => {
				session.run("sprite.create", { width: 4, height: 4 });
			}),
			"log.jsonl",
		);
		const run = new GalleryRun(join(path, ".."));
		expect(run.sprites()).toHaveLength(1);
		const next = new Session({ onLog: () => {} });
		next.run("sprite.create", { width: 4, height: 4 });
		const second = next.run("sprite.create", { width: 5, height: 5 });
		const line = JSON.stringify({
			kind: "step",
			checkpointId: second.checkpointId,
			op: "sprite.create",
			input: { width: 5, height: 5 },
			sprites: ["sprite-2"],
		});
		appendFileSync(path, line);
		expect(run.sprites()).toHaveLength(1);
		appendFileSync(path, "\n");
		expect(run.sprites().map((s) => s.spriteId)).toEqual([
			"sprite-1",
			"sprite-2",
		]);
	});

	test("a mismatched checkpoint stops the replay with a warning and for good", () => {
		const folder = buildRun((session) => {
			twoSprites(session);
			session.run("layer.create", { spriteId: "sprite-1", name: "a" });
		});
		rewriteLines(folder, (lines) => [
			...lines.slice(0, 3),
			breakStep(lines[3], "checkpoint-91"),
			breakStep(lines[2], "checkpoint-4"),
		]);
		const run = new GalleryRun(folder);
		expect(run.sprites().map((s) => s.spriteId)).toEqual([
			"sprite-1",
			"sprite-2",
		]);
		expect(run.warnings()).toEqual([
			expect.stringContaining("Replay stopped at step 91"),
		]);
		appendFileSync(
			join(folder, "log.jsonl"),
			`${JSON.stringify({ kind: "moved", checkpointId: "checkpoint-1" })}\n`,
		);
		expect(run.log("checkpoint-1")?.map((e) => e.kind)).toEqual([
			"step",
			"step",
		]);
	});

	test("a run with only the version line is hidden", () => {
		const folder = buildRun(() => {});
		expect(new GalleryRun(folder).summary()).toBeUndefined();
		expect(new GalleryRun(join(scratch, "missing")).summary()).toBeUndefined();
	});

	test("a corrupt log is listed with the read error as its warning", () => {
		const folder = buildRun((session) => {
			session.run("sprite.create", { width: 4, height: 4 });
		});
		appendFileSync(join(folder, "log.jsonl"), "not json\n");
		const run = new GalleryRun(folder);
		expect(run.summary()).toEqual({});
		expect(run.sprites()).toEqual([]);
		expect(run.warnings()).toEqual([
			expect.stringContaining("line 3 of log.jsonl is not valid JSON"),
		]);
	});

	test("a resumed run carries where it came from", () => {
		const folder = buildRun((session) => {
			session.run("sprite.create", { width: 4, height: 4 });
		});
		rewriteLines(folder, (lines) => [
			lines[0] as string,
			JSON.stringify({ kind: "resumed", run: "older", step: 1 }),
			...lines.slice(1),
		]);
		expect(new GalleryRun(folder).summary()).toEqual({
			resumedFrom: { run: "older", step: 1 },
		});
	});

	test("a log from another version carries the version warning first", () => {
		const folder = buildRun((session) => {
			session.run("sprite.create", { width: 4, height: 4 });
		});
		rewriteLines(folder, (lines) => [
			JSON.stringify({ ...JSON.parse(lines[0] as string), version: "9.9.9" }),
			...lines.slice(1),
		]);
		const [warning] = new GalleryRun(folder).warnings();
		expect(warning).toContain("ghosprite 9.9.9");
		expect(warning).toContain(`this is ghosprite ${version}`);
	});

	test("summary replays nothing", () => {
		const folder = buildRun((session) => {
			session.run("sprite.create", { width: 4, height: 4 });
			session.run("layer.create", { spriteId: "sprite-1", name: "a" });
		});
		const run = new GalleryRun(folder);
		expect(run.summary()).toEqual({});
		rewriteLines(folder, (lines) => [
			lines[0] as string,
			breakStep(lines[1], "checkpoint-91"),
			...lines.slice(2),
		]);
		expect(run.warnings()).toEqual([
			expect.stringContaining("Replay stopped at step 91"),
		]);
	});
});
