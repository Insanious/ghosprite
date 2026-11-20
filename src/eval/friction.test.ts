import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ask } from "./assign.ts";
import type { EvalDefinition } from "./checks.ts";
import { analyseRun, type FrictionFile } from "./friction.ts";
import { extractItems, parseTranscript } from "./items.ts";

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

function tempRun(withParts = true): string {
	const run = mkdtempSync(join(tmpdir(), "ghosprite-friction-"));
	folders.push(run);
	mkdirSync(run, { recursive: true });
	writeFileSync(join(run, "transcript.jsonl"), transcript());
	if (withParts) {
		writeFileSync(
			join(run, "parts.json"),
			JSON.stringify({
				classifier: null,
				items: [
					{ id: "t1", tool: "draw_image", part: "head", by: "keyword" },
					{ id: "t2#0", tool: "draw_line", part: "legs", by: "keyword" },
				],
				effort: {},
			}),
		);
	}
	return run;
}

const definition: EvalDefinition = { parts: ["head", "legs"], checks: [] };

const mcp = {
	instructions: "Ids are explicit.",
	tools: [
		{
			name: "draw_image",
			description: "Paints rows of legend characters.",
			inputSchema: { type: "object" },
		},
	],
};

function transcript(): string {
	const lines = [
		{
			type: "assistant",
			message: {
				id: "m1",
				content: [
					{ type: "text", text: "Drawing the head by hand." },
					{
						type: "tool_use",
						id: "t1",
						name: "mcp__ghosprite__draw_image",
						input: { rows: ["..XXXX..", ".XXXXXX."], note: "head" },
					},
				],
			},
		},
		{
			type: "assistant",
			message: {
				id: "m2",
				content: [
					{
						type: "tool_use",
						id: "t2",
						name: "mcp__ghosprite__session_apply",
						input: {
							label: "legs",
							ops: [{ op: "draw.line", x0: 0, y0: 0, x1: 5, y1: 9 }],
						},
					},
				],
			},
		},
	];
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

function reply(findings: unknown[], model = "claude-opus-test"): Ask {
	return async () => ({ answer: { findings }, model });
}

function finding(calls: string[], part = "head") {
	return { part, work: "placed pixels", tool: "draw_shape", calls };
}

function read(run: string): FrictionFile {
	return JSON.parse(
		readFileSync(join(run, "findings.json"), "utf8"),
	) as FrictionFile;
}

function tokensOf(run: string): Record<string, number> {
	const items = extractItems(
		parseTranscript(join(run, "transcript.jsonl")),
		[],
	).items;
	return Object.fromEntries(items.map((i) => [i.id, i.outputTokens]));
}

describe("analyseRun", () => {
	test("drops findings citing unknown ids or no calls, and counts them", async () => {
		const run = tempRun();
		await analyseRun(
			run,
			definition,
			"Draw.",
			mcp,
			reply([
				finding(["t1"]),
				finding(["nope"]),
				finding(["t1", "nope"]),
				finding([]),
			]),
		);
		const file = read(run);
		expect(file.findings.map((f) => f.calls)).toEqual([["t1"]]);
		expect(file.dropped).toBe(3);
	});

	test("drops a finding whose part is outside the parts", async () => {
		const run = tempRun();
		await analyseRun(
			run,
			definition,
			"Draw.",
			mcp,
			reply([finding(["t1"], "tail"), finding(["t1"], "other")]),
		);
		const file = read(run);
		expect(file.findings.map((f) => f.part)).toEqual(["other"]);
		expect(file.dropped).toBe(1);
	});

	test("accepts op ids inside a session_apply", async () => {
		const run = tempRun();
		await analyseRun(run, definition, "Draw.", mcp, reply([finding(["t2#0"])]));
		expect(read(run).findings[0]?.calls).toEqual(["t2#0"]);
	});

	test("sums effort once per id and lists each cited id once in callTokens", async () => {
		const run = tempRun();
		const tokens = tokensOf(run);
		await analyseRun(
			run,
			definition,
			"Draw.",
			mcp,
			reply([finding(["t1", "t1", "t2#0"]), finding(["t1"])]),
		);
		const file = read(run);
		const first = file.findings[0];
		expect(first?.calls).toEqual(["t1", "t2#0"]);
		expect(first?.effort.calls).toBe(2);
		expect(first?.effort.outputTokens).toBeCloseTo(
			(tokens.t1 ?? 0) + (tokens["t2#0"] ?? 0),
		);
		expect(file.callTokens).toEqual({
			t1: tokens.t1 ?? 0,
			"t2#0": tokens["t2#0"] ?? 0,
		});
	});

	test("writes findings.json when there are no findings", async () => {
		const run = tempRun();
		await analyseRun(run, definition, "Draw.", mcp, reply([]));
		expect(read(run)).toEqual({
			analyst: "claude-opus-test",
			dropped: 0,
			findings: [],
			callTokens: {},
		});
	});

	test("skips a run with findings.json unless forced", async () => {
		const run = tempRun();
		await analyseRun(run, definition, "Draw.", mcp, reply([]));
		let asked = 0;
		const counting: Ask = async (...args) => {
			asked++;
			return reply([])(...args);
		};
		expect(await analyseRun(run, definition, "Draw.", mcp, counting)).toBe(
			false,
		);
		expect(asked).toBe(0);
		expect(
			await analyseRun(run, definition, "Draw.", mcp, counting, true),
		).toBe(true);
		expect(asked).toBe(1);
	});

	test("skips a run without parts.json and never asks", async () => {
		const run = tempRun(false);
		const noAsk: Ask = async () => {
			throw new Error("ask should not be called");
		};
		expect(await analyseRun(run, definition, "Draw.", mcp, noAsk)).toBe(false);
		expect(existsSync(join(run, "findings.json"))).toBe(false);
	});

	test("puts descriptions, instructions, parts and full input in the prompt", async () => {
		const run = tempRun();
		let prompt = "";
		const ask: Ask = async (text) => {
			prompt = text;
			return { answer: { findings: [] }, model: "m" };
		};
		await analyseRun(run, definition, "Draw a scientist.", mcp, ask);
		expect(prompt).toContain("Paints rows of legend characters.");
		expect(prompt).toContain("Ids are explicit.");
		expect(prompt).toContain("Draw a scientist.");
		expect(prompt).toContain("head, legs, other");
		expect(prompt).toContain(".XXXXXX.");
		expect(prompt).toContain("Drawing the head by hand.");
	});

	test("records the model the reply reports", async () => {
		const run = tempRun();
		await analyseRun(run, definition, "Draw.", mcp, reply([], "claude-opus-9"));
		expect(read(run).analyst).toBe("claude-opus-9");
	});
});
