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
import { assignRun, buildReport, spread } from "./report.ts";

const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

function tempSet(): string {
	const root = mkdtempSync(join(tmpdir(), "ghosprite-report-"));
	folders.push(root);
	const set = join(root, "scientist", "set");
	mkdirSync(set, { recursive: true });
	return set;
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, JSON.stringify(value));
}

const definition: EvalDefinition = {
	parts: ["head", "legs"],
	checks: [
		{
			name: "head drawn",
			part: "head",
			run: () => ({ pass: true, detail: "" }),
		},
		{
			name: "legs drawn",
			part: "legs",
			run: () => ({ pass: true, detail: "" }),
		},
	],
};

const noAsk: Ask = async () => {
	throw new Error("ask should not be called");
};

function transcript(): string {
	const lines = [
		{
			type: "assistant",
			message: {
				id: "m1",
				content: [
					{
						type: "tool_use",
						id: "t1",
						name: "Bash",
						input: { command: "ls", note: "head outline" },
					},
				],
			},
		},
		{
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: "ok",
						is_error: false,
					},
				],
			},
		},
	];
	return lines.map((line) => JSON.stringify(line)).join("\n");
}

function effort(calls: number) {
	return { calls };
}

type RunFiles = {
	effort?: Record<string, { calls: number }>;
	passed?: boolean[];
	costUsd?: number | null;
	output?: number | null;
};

function writeRun(set: string, name: string, files: RunFiles): void {
	const folder = join(set, name);
	mkdirSync(folder, { recursive: true });
	if (files.effort) {
		writeJson(join(folder, "parts.json"), {
			classifier: null,
			items: [],
			effort: files.effort,
		});
	}
	writeJson(join(folder, "checks.json"), {
		checks: definition.checks.map((check, i) => ({
			name: check.name,
			part: check.part,
			pass: files.passed?.[i] ?? true,
		})),
	});
	writeJson(join(folder, "metrics.json"), {
		requests: 10,
		costUsd: files.costUsd === undefined ? 1 : files.costUsd,
		tokens: { output: files.output === undefined ? 100 : files.output },
	});
	writeJson(join(folder, "metadata.json"), {
		wallSeconds: 60,
		mcp: { bytes: 500 },
	});
}

describe("assignRun", () => {
	test("writes parts.json once and leaves an existing one alone", async () => {
		const run = join(tempSet(), "1");
		mkdirSync(run);
		writeFileSync(join(run, "transcript.jsonl"), transcript());
		expect(await assignRun(run, definition, "prompt", [], noAsk)).toBe(true);
		const written = JSON.parse(readFileSync(join(run, "parts.json"), "utf8"));
		expect(written.classifier).toBeNull();
		expect(written.items).toEqual([
			{
				id: "t1",
				tool: "Bash",
				note: "head outline",
				part: "head",
				by: "keyword",
			},
		]);
		expect(written.effort.head.calls).toBe(1);
		expect(written.effort.legs.calls).toBe(0);

		writeFileSync(join(run, "parts.json"), "kept");
		expect(await assignRun(run, definition, "prompt", [], noAsk)).toBe(false);
		expect(readFileSync(join(run, "parts.json"), "utf8")).toBe("kept");
		expect(await assignRun(run, definition, "prompt", [], noAsk, true)).toBe(
			true,
		);
		expect(readFileSync(join(run, "parts.json"), "utf8")).not.toBe("kept");
	});

	test("without a transcript writes nothing", async () => {
		const run = join(tempSet(), "1");
		mkdirSync(run);
		expect(await assignRun(run, definition, "prompt", [], noAsk)).toBe(false);
		expect(existsSync(join(run, "parts.json"))).toBe(false);
	});
});

describe("spread", () => {
	test("median of odd and even counts", () => {
		expect(spread([3, 1, 2])).toEqual({ median: 2, min: 1, max: 3 });
		expect(spread([4, 1, 3, 2])).toEqual({ median: 2.5, min: 1, max: 4 });
	});

	test("skips nulls, and gives null when nothing is left", () => {
		expect(spread([null, 5, 1])).toEqual({ median: 3, min: 1, max: 5 });
		expect(spread([null, null])).toEqual({
			median: null,
			min: null,
			max: null,
		});
	});
});

describe("buildReport", () => {
	test("lists runs without parts.json and leaves them out of the parts", () => {
		const set = tempSet();
		writeRun(set, "1", { effort: { head: effort(4), legs: effort(2) } });
		writeRun(set, "2", {});
		const report = buildReport(set, definition);
		expect(report.eval).toBe("scientist");
		expect(report.runs).toBe(2);
		expect(report.runsWithoutParts).toEqual(["2"]);
		expect(report.parts.head?.calls).toEqual({ median: 4, min: 4, max: 4 });
	});

	test("a part used in no run shows zeros, with other last", () => {
		const set = tempSet();
		writeRun(set, "1", { effort: { head: effort(4) } });
		const report = buildReport(set, definition);
		expect(Object.keys(report.parts)).toEqual(["head", "legs", "other"]);
		expect(report.parts.legs?.calls).toEqual({ median: 0, min: 0, max: 0 });
		expect(report.parts.other?.errors).toEqual({ median: 0, min: 0, max: 0 });
	});

	test("a null cost is left out of the median, all null gives null", () => {
		const set = tempSet();
		writeRun(set, "1", { costUsd: 1, output: 100 });
		writeRun(set, "2", { costUsd: null, output: null });
		writeRun(set, "3", { costUsd: 3, output: 300 });
		const { totals } = buildReport(set, definition);
		expect(totals.costUsd).toEqual({ median: 2, min: 1, max: 3 });
		expect(totals.outputTokens).toEqual({ median: 200, min: 100, max: 300 });
		expect(totals.mcpBytes.median).toBe(500);
		expect(totals.wallSeconds.median).toBe(60);
		expect(totals.requests.median).toBe(10);

		const allNull = tempSet();
		writeRun(allNull, "1", { costUsd: null });
		expect(buildReport(allNull, definition).totals.costUsd).toEqual({
			median: null,
			min: null,
			max: null,
		});
	});

	test("check pass rates count runs", () => {
		const set = tempSet();
		writeRun(set, "1", { passed: [true, false] });
		writeRun(set, "2", { passed: [false, false] });
		writeRun(set, "3", { passed: [true, true] });
		const { checks } = buildReport(set, definition);
		expect(checks["head drawn"]).toEqual({ part: "head", passed: 2, runs: 3 });
		expect(checks["legs drawn"]).toEqual({ part: "legs", passed: 1, runs: 3 });
	});
});
