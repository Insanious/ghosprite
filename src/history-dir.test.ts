import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyDir, latestRun } from "./history-dir.ts";

const scratch = mkdtempSync(join(tmpdir(), "ghosprite-history-dir-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function historyWith(name: string, folders: string[], files: string[] = []) {
	const dir = join(scratch, name);
	mkdirSync(dir);
	for (const folder of folders) mkdirSync(join(dir, folder));
	for (const file of files) writeFileSync(join(dir, file), "");
	return dir;
}

describe("latestRun", () => {
	test("a missing folder and an empty folder give undefined", () => {
		expect(latestRun(join(scratch, "missing"))).toBeUndefined();
		expect(latestRun(historyWith("empty", []))).toBeUndefined();
	});

	test("the later second wins regardless of creation order", () => {
		const dir = historyWith("seconds", [
			"2026-01-02T00-00-00",
			"2026-01-01T00-00-00",
		]);
		expect(latestRun(dir)).toBe(join(dir, "2026-01-02T00-00-00"));
	});

	test("a numeric suffix orders as a number, and no suffix is the first run", () => {
		const dir = historyWith("suffix", [
			"2026-01-01T10-20-30-2",
			"2026-01-01T10-20-30-10",
			"2026-01-01T10-20-30",
		]);
		expect(latestRun(dir)).toBe(join(dir, "2026-01-01T10-20-30-10"));
		const pair = historyWith("suffix-pair", [
			"2026-01-01T10-20-30",
			"2026-01-01T10-20-30-2",
		]);
		expect(latestRun(pair)).toBe(join(pair, "2026-01-01T10-20-30-2"));
	});

	test("files named like a run and folders with other names are ignored", () => {
		const dir = historyWith(
			"ignored",
			["2026-01-01T00-00-00", "notes", "zzz"],
			["2026-02-01T00-00-00"],
		);
		expect(latestRun(dir)).toBe(join(dir, "2026-01-01T00-00-00"));
		expect(latestRun(historyWith("only-ignored", ["notes"]))).toBeUndefined();
	});

	test("a history path that is a file throws", () => {
		const file = join(scratch, "a-file");
		writeFileSync(file, "");
		expect(() => latestRun(file)).toThrow();
	});
});

describe("historyDir", () => {
	test("the flag wins over GHOSPRITE_HISTORY", () => {
		expect(
			historyDir("a", { GHOSPRITE_HISTORY: "b" }, "linux", "/home/u"),
		).toBe("a");
	});

	test("GHOSPRITE_HISTORY is returned as given", () => {
		expect(
			historyDir(undefined, { GHOSPRITE_HISTORY: "b" }, "linux", "/home/u"),
		).toBe("b");
	});

	test("an empty GHOSPRITE_HISTORY falls through to the default", () => {
		expect(
			historyDir(undefined, { GHOSPRITE_HISTORY: "" }, "linux", "/home/u"),
		).toBe("/home/u/.local/state/ghosprite/runs");
	});

	test("linux uses XDG_STATE_HOME when set", () => {
		expect(
			historyDir(undefined, { XDG_STATE_HOME: "/x/state" }, "linux", "/home/u"),
		).toBe("/x/state/ghosprite/runs");
	});

	test("linux falls back to .local/state when XDG_STATE_HOME is unset or empty", () => {
		expect(historyDir(undefined, {}, "linux", "/home/u")).toBe(
			"/home/u/.local/state/ghosprite/runs",
		);
		expect(
			historyDir(undefined, { XDG_STATE_HOME: "" }, "linux", "/home/u"),
		).toBe("/home/u/.local/state/ghosprite/runs");
	});

	test("win32 uses LOCALAPPDATA when set", () => {
		expect(
			historyDir(
				undefined,
				{ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
				"win32",
				"C:\\Users\\u",
			),
		).toBe("C:\\Users\\u\\AppData\\Local\\ghosprite\\runs");
	});

	test("win32 falls back to the home AppData folder when LOCALAPPDATA is empty", () => {
		expect(
			historyDir(undefined, { LOCALAPPDATA: "" }, "win32", "C:\\Users\\u"),
		).toBe("C:\\Users\\u\\AppData\\Local\\ghosprite\\runs");
	});

	test("darwin ignores XDG_STATE_HOME", () => {
		expect(
			historyDir(
				undefined,
				{ XDG_STATE_HOME: "/x/state" },
				"darwin",
				"/Users/u",
			),
		).toBe("/Users/u/Library/Application Support/ghosprite/runs");
	});

	test("other platforms follow the linux rule", () => {
		expect(historyDir(undefined, {}, "freebsd", "/home/u")).toBe(
			"/home/u/.local/state/ghosprite/runs",
		);
	});
});
