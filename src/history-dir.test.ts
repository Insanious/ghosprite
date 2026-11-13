import { describe, expect, test } from "bun:test";
import { historyDir } from "./history-dir.ts";

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
