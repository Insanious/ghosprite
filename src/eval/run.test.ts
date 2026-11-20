import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRunLog } from "../run-log.ts";
import { Session } from "../session.ts";
import { classifyCap, claudeArgs, rebuildRun, setFolder } from "./run.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "eval-run-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

const caps = { maxTurns: 150, maxBudgetUsd: 5, minutes: 30 };

describe("claudeArgs", () => {
	const args = claudeArgs("draw it", "sonnet", caps, "/runs/1");

	test("isolates the session and caps it", () => {
		const at = (flag: string) => args.indexOf(flag);
		expect(args.slice(0, 2)).toEqual(["-p", "draw it"]);
		expect(args[at("--setting-sources") + 1]).toBe("");
		expect(args).toContain("--strict-mcp-config");
		expect(args[at("--tools") + 1]).toBe("Bash");
		expect(args[at("--max-turns") + 1]).toBe("150");
		expect(args[at("--max-budget-usd") + 1]).toBe("5");
	});

	test("the MCP config has only ghosprite, without a viewer, writing inside the run folder", () => {
		const json = args[args.indexOf("--mcp-config") + 1] as string;
		const { mcpServers } = JSON.parse(json);
		expect(Object.keys(mcpServers)).toEqual(["ghosprite"]);
		const serverArgs = mcpServers.ghosprite.args as string[];
		expect(serverArgs).toContain("--no-viewer");
		expect(serverArgs[serverArgs.indexOf("--history") + 1]).toBe(
			"/runs/1/ghosprite",
		);
	});
});

test("classifyCap", () => {
	expect(classifyCap("error_max_turns", false)).toBe("turns");
	expect(classifyCap("error_max_budget_usd", false)).toBe("budget");
	expect(classifyCap(undefined, true)).toBe("time");
	expect(classifyCap("success", false)).toBeNull();
});

test("setFolder adds a number when the folder exists", () => {
	const first = setFolder(root, "scientist", "2026-01-02", "sonnet", "abc1234");
	expect(first).toBe(join(root, "scientist", "2026-01-02-sonnet-abc1234"));
	mkdirSync(first, { recursive: true });
	expect(setFolder(root, "scientist", "2026-01-02", "sonnet", "abc1234")).toBe(
		`${first}-2`,
	);
});

describe("rebuildRun", () => {
	function record() {
		const log = startRunLog(join(root, "ghosprite"));
		const session = new Session({ onLog: (entry) => log.append(entry) });
		const { spriteId } = session.run("sprite.create", {
			width: 4,
			height: 4,
		}) as unknown as { spriteId: string };
		const { layerId } = session.run("layer.create", {
			spriteId,
		}) as unknown as { layerId: string };
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			color: "#ff0000",
			rect: { x: 0, y: 0, width: 2, height: 2 },
			filled: true,
		});
		return { log, spriteId };
	}

	test("writes the PNGs and the .aseprite", () => {
		const { spriteId } = record();
		const out = join(root, "out");
		mkdirSync(out);
		const rebuilt = rebuildRun(join(root, "ghosprite"), out);
		expect(rebuilt.sprites).toHaveLength(1);
		expect(rebuilt.exportErrors).toEqual({});
		for (const file of [
			`${spriteId}.png`,
			`${spriteId}@8x.png`,
			`${spriteId}.aseprite`,
		]) {
			expect(existsSync(join(out, file))).toBe(true);
		}
	});

	test("a replay that stops still exports what was rebuilt", () => {
		const { log, spriteId } = record();
		appendFileSync(
			join(log.folder, "log.jsonl"),
			`${JSON.stringify({ kind: "step", op: "sprite.flip", input: { spriteId, direction: "horizontal" }, checkpointId: "checkpoint-9", sprites: [spriteId] })}\n`,
		);
		const out = join(root, "out");
		mkdirSync(out);
		const rebuilt = rebuildRun(join(root, "ghosprite"), out);
		expect(rebuilt.replay?.stopped).toBeDefined();
		expect(existsSync(join(out, `${spriteId}.png`))).toBe(true);
	});

	test("no log gives no sprites", () => {
		expect(rebuildRun(join(root, "none"), root).sprites).toEqual([]);
	});
});
