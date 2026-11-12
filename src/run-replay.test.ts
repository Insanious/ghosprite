import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	copyFileSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../package.json";
import { startRunLog } from "./run-log.ts";
import { readRun, replayRun, versionWarning } from "./run-replay.ts";
import { type LogEntry, Session } from "./session.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-replay-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function recorded() {
	const log = startRunLog(join(root, "runs"));
	const session = new Session({ onLog: (entry) => log.append(entry) });
	return { log, session };
}

function drawThreeSteps(session: Session) {
	const { spriteId } = session.run("sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	session.run("layer.create", { spriteId, name: "L" });
	session.run("sprite.flip", { spriteId, direction: "horizontal" });
	session.undo();
	session.run("sprite.flip", { spriteId, direction: "vertical" });
}

describe("replayRun", () => {
	test("a run with an undo replays to the same step log", () => {
		const { log, session } = recorded();
		drawThreeSteps(session);

		const { entries } = readRun(log.folder);
		const fresh = new Session();
		expect(replayRun(fresh, log.folder, entries)).toEqual({});
		expect(fresh.stepLog()).toEqual(session.stepLog());
		expect(entries.some((entry) => entry.kind === "moved")).toBe(true);
	});

	test("a loaded file is read from the run folder after the original is gone", () => {
		const copy = join(root, "base.aseprite");
		copyFileSync("tests/fixtures/doc/base.aseprite", copy);
		const { log, session } = recorded();
		session.run("sprite.load", { path: copy });
		rmSync(copy);

		const { entries } = readRun(log.folder);
		const fresh = new Session();
		expect(replayRun(fresh, log.folder, entries)).toEqual({});
		const step = fresh.stepLog()[0] as Extract<LogEntry, { kind: "step" }>;
		expect((step.input as { path: string }).path.startsWith(log.folder)).toBe(
			true,
		);
	});

	test("a load whose stored file is missing stops the replay and keeps earlier steps", () => {
		const copy = join(root, "base.aseprite");
		copyFileSync("tests/fixtures/doc/base.aseprite", copy);
		const { log, session } = recorded();
		session.run("sprite.create", { width: 2, height: 2 });
		session.run("sprite.load", { path: copy });

		const { entries } = readRun(log.folder);
		const stored = (entries[1] as { input: { path: string } }).input.path;
		rmSync(join(log.folder, stored));
		const fresh = new Session();
		const { stopped } = replayRun(fresh, log.folder, entries);
		expect(stopped?.checkpointId).toBe("checkpoint-2");
		expect(stopped?.message).toBeTruthy();
		expect(fresh.stepLog()).toHaveLength(1);
	});

	test("a step that replays to another checkpoint id stops the replay", () => {
		const { log, session } = recorded();
		session.run("sprite.create", { width: 2, height: 2 });
		const { entries } = readRun(log.folder);
		const shifted = entries.map((entry) => ({
			...entry,
			checkpointId: "checkpoint-7",
		}));
		const { stopped } = replayRun(new Session(), log.folder, shifted);
		expect(stopped).toEqual({
			checkpointId: "checkpoint-7",
			message: "replayed as checkpoint-1, expected checkpoint-7",
		});
	});
});

describe("readRun", () => {
	test("an unfinished last line is dropped and a finished one is kept", () => {
		const { log, session } = recorded();
		session.run("sprite.create", { width: 2, height: 2 });
		const logPath = join(log.folder, "log.jsonl");
		const complete = readFileSync(logPath, "utf8");
		expect(readRun(log.folder).entries).toHaveLength(1);

		writeFileSync(logPath, complete.slice(0, -1));
		expect(readRun(log.folder).entries).toHaveLength(0);
	});

	test("a missing log.jsonl throws naming the folder", () => {
		expect(() => readRun(root)).toThrow(root);
	});

	test("a first line that is not a run line throws", () => {
		writeFileSync(join(root, "log.jsonl"), '{"kind":"moved"}\n');
		expect(() => readRun(root)).toThrow("line 1");
	});

	test("a complete line that is not JSON throws with its number", () => {
		const { log } = recorded();
		const logPath = join(log.folder, "log.jsonl");
		writeFileSync(logPath, `${readFileSync(logPath, "utf8")}{oops\n`);
		expect(() => readRun(log.folder)).toThrow("line 2");
	});

	test("a resumed line is returned and left out of entries", () => {
		const { log, session } = recorded();
		session.run("sprite.create", { width: 2, height: 2 });
		const logPath = join(log.folder, "log.jsonl");
		const [run, ...rest] = readFileSync(logPath, "utf8").split("\n");
		const resumed = JSON.stringify({ kind: "resumed", run: "/old", step: 4 });
		writeFileSync(logPath, [run, resumed, ...rest].join("\n"));
		const read = readRun(log.folder);
		expect(read.resumedFrom).toEqual({ run: "/old", step: 4 });
		expect(read.entries).toHaveLength(1);
	});

	test("a resumed line with wrong field types throws", () => {
		const { log } = recorded();
		const logPath = join(log.folder, "log.jsonl");
		writeFileSync(
			logPath,
			`${readFileSync(logPath, "utf8")}{"kind":"resumed","run":1,"step":"x"}\n`,
		);
		expect(() => readRun(log.folder)).toThrow("line 2");
	});

	test("a resumed line on line 3 throws with its line number", () => {
		const { log, session } = recorded();
		session.run("sprite.create", { width: 2, height: 2 });
		const logPath = join(log.folder, "log.jsonl");
		writeFileSync(
			logPath,
			`${readFileSync(logPath, "utf8")}{"kind":"resumed","run":"/old","step":1}\n`,
		);
		expect(() => readRun(log.folder)).toThrow("line 3");
	});
});

describe("versionWarning", () => {
	test("is undefined for this version and names both otherwise", () => {
		expect(versionWarning(version)).toBeUndefined();
		const warning = versionWarning("0.0.0-old");
		expect(warning).toContain("0.0.0-old");
		expect(warning).toContain(version);
	});
});

describe("resuming a run", () => {
	test("a resumed run replays on its own to the same steps", () => {
		const copy = join(root, "base.aseprite");
		copyFileSync("tests/fixtures/doc/base.aseprite", copy);
		const first = recorded();
		const { spriteId } = first.session.run("sprite.load", {
			path: copy,
		}) as unknown as { spriteId: string };
		first.session.run("sprite.flip", { spriteId, direction: "horizontal" });
		rmSync(copy);

		const { entries } = readRun(first.log.folder);
		const log2 = startRunLog(join(root, "runs"));
		const session2 = new Session({ onLog: (entry) => log2.append(entry) });
		log2.resume(first.log.folder, 2, entries, () =>
			replayRun(session2, first.log.folder, entries),
		);
		rmSync(first.log.folder, { recursive: true });

		const second = readRun(log2.folder);
		expect(second.resumedFrom).toEqual({ run: first.log.folder, step: 2 });
		const session3 = new Session();
		expect(replayRun(session3, log2.folder, second.entries)).toEqual({});

		const kinds = (session: Session) =>
			session
				.stepLog()
				.map((entry) => [entry.kind, entry.checkpointId] as const);
		expect(kinds(session3)).toEqual(kinds(first.session));
		expect(kinds(session2)).toEqual(kinds(first.session));
		const describeSprite = (session: Session) =>
			session.run("sprite.describe", { spriteId });
		expect(describeSprite(session3)).toEqual(describeSprite(first.session));
	});
});
