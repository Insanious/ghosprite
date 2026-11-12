import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpError } from "./errors.ts";
import { type RunLog, startRunLog } from "./run-log.ts";
import { resumeTool } from "./run-resume.ts";
import { Session } from "./session.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-resume-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function recorded(dir = join(root, "runs"), now?: Date) {
	const log = startRunLog(dir, now);
	const session = new Session({ onLog: (entry) => log.append(entry) });
	return { log, session };
}

function drawFourSteps(session: Session) {
	const { spriteId } = session.run("sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	session.run("layer.create", { spriteId, name: "L" });
	session.run("sprite.flip", { spriteId, direction: "horizontal" });
	session.undo();
	session.run("sprite.flip", { spriteId, direction: "vertical" });
	return spriteId;
}

function resume(
	session: Session,
	run: string,
	step: number,
	history?: { dir: string; log: RunLog },
) {
	return resumeTool(history).run(session, { run, step } as never) as {
		checkpointId: string;
		sprites: string[];
		run?: string;
		warning?: string;
	};
}

function codeOf(fn: () => unknown) {
	try {
		fn();
	} catch (error) {
		return error instanceof OpError ? [error.code, error.path] : error;
	}
	return undefined;
}

function describeAll(session: Session) {
	return session.workspace
		.spriteIds()
		.map((spriteId) => session.run("sprite.describe", { spriteId }));
}

describe("session.resume", () => {
	test("rebuilds a prefix of the step log with the same ids", () => {
		const first = recorded();
		drawFourSteps(first.session);
		const full = first.session.stepLog();
		const upTo = full.findIndex((e) => e.checkpointId === "checkpoint-4");
		const reference = new Session();
		for (const e of full.slice(0, upTo + 1)) {
			if (e.kind === "moved") reference.restore(e.checkpointId);
			else reference.run(e.op, e.input);
		}

		const second = new Session();
		const result = resume(second, first.log.folder, 4);
		expect(result.checkpointId).toBe("checkpoint-4");
		expect(result.warning).toBeUndefined();
		expect(second.stepLog()).toEqual(full.slice(0, upTo + 1));
		expect(describeAll(second)).toEqual(describeAll(reference));

		second.run("sprite.flip", {
			spriteId: result.sprites[0],
			direction: "horizontal",
		});
		expect(second.stepLog().at(-1)?.checkpointId).toBe("checkpoint-5");
	});

	test("resumes a step that was abandoned", () => {
		const first = recorded();
		drawFourSteps(first.session);
		const second = new Session();
		resume(second, first.log.folder, 3);
		expect(second.stepLog()).toEqual(first.session.stepLog().slice(0, 3));
	});

	test("refuses a session that already has a step", () => {
		const first = recorded();
		drawFourSteps(first.session);
		const second = new Session();
		second.run("sprite.create", { width: 1, height: 1 });
		expect(codeOf(() => resume(second, first.log.folder, 1))).toEqual([
			"unsupported",
			"",
		]);
		expect(second.stepLog()).toHaveLength(1);
	});

	test("an unknown step or run is not_found", () => {
		const first = recorded();
		drawFourSteps(first.session);
		expect(codeOf(() => resume(new Session(), first.log.folder, 99))).toEqual([
			"not_found",
			"step",
		]);
		expect(codeOf(() => resume(new Session(), join(root, "none"), 1))).toEqual([
			"not_found",
			"run",
		]);
	});

	test("a run whose stored file was deleted fails and leaves no steps", () => {
		const first = recorded();
		const path = join(root, "base.aseprite");
		writeFileSync(path, readFileSync("tests/fixtures/doc/base.aseprite"));
		first.session.run("sprite.load", { path });
		const files = join(first.log.folder, "files");
		for (const file of readdirSync(files)) rmSync(join(files, file));
		const second = new Session();
		expect(codeOf(() => resume(second, first.log.folder, 1))).toEqual([
			"invalid_input",
			"run",
		]);
		expect(second.stepLog()).toEqual([]);
	});

	test("warns only when the version differs", () => {
		const first = recorded();
		drawFourSteps(first.session);
		expect(resume(new Session(), first.log.folder, 1).warning).toBeUndefined();
		const logPath = join(first.log.folder, "log.jsonl");
		const text = readFileSync(logPath, "utf8");
		writeFileSync(
			logPath,
			text.replace(/"version":"[^"]*"/, '"version":"0.0.1"'),
		);
		expect(resume(new Session(), first.log.folder, 1).warning).toContain(
			"0.0.1",
		);
	});

	test("with history, a bare name is found and the new log holds the prefix", () => {
		const dir = join(root, "runs");
		const first = recorded(dir, new Date(2020, 0, 1));
		drawFourSteps(first.session);
		const log2 = startRunLog(dir, new Date(2021, 0, 1));
		const second = new Session({ onLog: (entry) => log2.append(entry) });
		const result = resume(second, first.log.name, 2, { dir, log: log2 });
		expect(result.run).toBe(log2.name);

		second.run("sprite.flip", {
			spriteId: result.sprites[0],
			direction: "horizontal",
		});
		const lines = readFileSync(join(log2.folder, "log.jsonl"), "utf8")
			.split("\n")
			.slice(0, -1)
			.map((line) => JSON.parse(line));
		expect(lines.map((l) => l.kind)).toEqual([
			"run",
			"resumed",
			"step",
			"step",
			"step",
		]);
		expect(lines[1]).toEqual({
			kind: "resumed",
			run: first.log.folder,
			step: 2,
		});
		expect(lines.map((l) => l.checkpointId)).toEqual([
			undefined,
			undefined,
			"checkpoint-1",
			"checkpoint-2",
			"checkpoint-3",
		]);
	});
});
