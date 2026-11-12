import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRunLog } from "./run-log.ts";
import type { LogEntry } from "./session.ts";

const NOW = new Date("2026-11-12T14:03:22.456Z");

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "run-log-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function step(op: string, input: unknown): LogEntry {
	return { kind: "step", checkpointId: "checkpoint-1", op, input, sprites: [] };
}

function lines(folder: string): Record<string, unknown>[] {
	return readFileSync(join(folder, "log.jsonl"), "utf8")
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line));
}

function lastLine(folder: string): Record<string, unknown> {
	const line = lines(folder).at(-1);
	if (!line) throw new Error("log is empty");
	return line;
}

describe("startRunLog", () => {
	test("names the folder from the start time and creates dir", () => {
		const log = startRunLog(join(root, "a", "b"), NOW);
		expect(log.name).toBe("2026-11-12T14-03-22");
		expect(log.folder).toBe(join(root, "a", "b", log.name));
		expect(existsSync(log.folder)).toBe(true);
	});

	test("a clash gets a numeric suffix", () => {
		expect(startRunLog(root, NOW).name).toBe("2026-11-12T14-03-22");
		expect(startRunLog(root, NOW).name).toBe("2026-11-12T14-03-22-2");
		expect(startRunLog(root, NOW).name).toBe("2026-11-12T14-03-22-3");
	});

	test("the first line has kind, version and started", () => {
		const log = startRunLog(root, NOW);
		const [first] = lines(log.folder);
		expect(first).toEqual({
			kind: "run",
			version: expect.any(String),
			started: NOW.toISOString(),
		});
	});
});

describe("append", () => {
	test("adds one line per entry and leaves earlier lines alone", () => {
		const log = startRunLog(root, NOW);
		const first = step("draw.rect", { note: "x" });
		const second: LogEntry = { kind: "moved", checkpointId: "checkpoint-1" };
		log.append(first);
		const before = readFileSync(join(log.folder, "log.jsonl"), "utf8");
		log.append(second);
		const after = readFileSync(join(log.folder, "log.jsonl"), "utf8");
		expect(after.startsWith(before)).toBe(true);
		expect(lines(log.folder).slice(1)).toEqual([first, second]);
	});

	test("a sprite.load stores a copy by hash and rewrites the path", () => {
		const source = join(root, "hero.aseprite");
		writeFileSync(source, Buffer.from([1, 2, 3, 4]));
		const log = startRunLog(join(root, "runs"), NOW);
		log.append(step("sprite.load", { path: source }));
		rmSync(source);

		const line = lastLine(log.folder);
		const stored = (line.input as { path: string }).path;
		expect(stored).toMatch(/^files\/[0-9a-f]{64}\.aseprite$/);
		expect(line.loadedFrom).toEqual({ [stored]: source });
		expect([...readFileSync(join(log.folder, stored))]).toEqual([1, 2, 3, 4]);
	});

	test("a palette.load inside a batch is rewritten in place", () => {
		const source = join(root, "pal.gpl");
		writeFileSync(source, "palette");
		const log = startRunLog(join(root, "runs"), NOW);
		const other = { op: "draw.rect", input: { x: 1 } };
		log.append(
			step("session.apply", {
				ops: [other, { op: "palette.load", input: { path: source, id: 1 } }],
			}),
		);

		const line = lastLine(log.folder);
		const ops = (line.input as { ops: { op: string; input: unknown }[] }).ops;
		expect(ops[0]).toEqual(other);
		const loaded = ops[1]?.input as { path: string; id: number };
		const stored = loaded.path;
		expect(stored).toMatch(/^files\/[0-9a-f]{64}\.gpl$/);
		expect(loaded.id).toBe(1);
		expect(line.loadedFrom).toEqual({ [stored]: source });
	});

	test("the same file is stored once and a changed file twice", () => {
		const source = join(root, "hero.aseprite");
		const log = startRunLog(join(root, "runs"), NOW);
		writeFileSync(source, "one");
		log.append(step("sprite.load", { path: source }));
		log.append(step("sprite.load", { path: source }));
		writeFileSync(source, "two");
		log.append(step("sprite.load", { path: source }));

		const paths = lines(log.folder)
			.slice(1)
			.map((line) => (line.input as { path: string }).path);
		expect(paths[0]).toBe(paths[1]);
		expect(paths[2]).not.toBe(paths[0]);
	});

	test("entries that load nothing are written unchanged", () => {
		const log = startRunLog(root, NOW);
		const entries: LogEntry[] = [
			step("draw.rect", { path: "not-a-load" }),
			{ kind: "moved", checkpointId: "checkpoint-2" },
		];
		for (const entry of entries) log.append(entry);
		expect(lines(log.folder).slice(1)).toEqual(entries);
	});

	test("a vanished file logs the original path and does not throw", () => {
		const missing = join(root, "gone.aseprite");
		const log = startRunLog(root, NOW);
		const write = spyOn(process.stderr, "write").mockImplementation(() => true);
		try {
			log.append(step("sprite.load", { path: missing }));
			expect(write.mock.calls[0]?.[0]).toStartWith("ghosprite: history: ");
		} finally {
			write.mockRestore();
		}
		const line = lastLine(log.folder);
		expect(line.input).toEqual({ path: missing });
		expect(line).not.toHaveProperty("loadedFrom");
	});
});
