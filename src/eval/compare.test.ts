import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSameEval, compareSets, row, UsageError } from "./compare.ts";
import type { Effort } from "./effort.ts";
import type { Report, Spread } from "./report.ts";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "compare-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const fixed = (n: number): Spread => ({ median: n, min: n, max: n });

function effort(values: Partial<Record<keyof Effort, number>>) {
	const fields = [
		"calls",
		"errors",
		"outputTokens",
		"thinkingTokens",
		"renderRedraws",
		"redraws",
		"handPixelChars",
		"unknown",
		"chains",
	] as const;
	return Object.fromEntries(
		fields.map((f) => [f, fixed(values[f] ?? 0)]),
	) as Report["parts"][string];
}

type SetSpec = {
	evalName?: string;
	name: string;
	parts: Record<string, Partial<Record<keyof Effort, number>>>;
	mcpBytes?: number;
	prompt?: string;
	toolsPerRun?: string[][];
};

function makeSet(spec: SetSpec): string {
	const folder = join(root, spec.evalName ?? "scientist", spec.name);
	mkdirSync(folder, { recursive: true });
	const report: Report = {
		eval: spec.evalName ?? "scientist",
		runs: 3,
		parts: Object.fromEntries(
			Object.entries(spec.parts).map(([p, v]) => [p, effort(v)]),
		),
		checks: { "has hood": { part: "hood", passed: 2, runs: 3 } },
		totals: {
			costUsd: fixed(1),
			requests: fixed(10),
			outputTokens: fixed(1000),
			wallSeconds: fixed(60),
			mcpBytes: fixed(spec.mcpBytes ?? 100),
		},
		runsWithoutParts: [],
	};
	writeFileSync(join(folder, "report.json"), JSON.stringify(report));
	(spec.toolsPerRun ?? [[], [], []]).forEach((tools, i) => {
		const run = join(folder, String(i + 1));
		mkdirSync(run);
		writeFileSync(
			join(run, "metadata.json"),
			JSON.stringify({ promptSha256: spec.prompt ?? "p" }),
		);
		writeFileSync(
			join(run, "parts.json"),
			JSON.stringify({
				classifier: null,
				items: tools.map((tool, n) => ({
					id: `t${n}`,
					tool,
					part: "other",
					by: "keyword",
				})),
				effort: {},
			}),
		);
	});
	return folder;
}

const none = { newTools: [] as string[] };

describe("compareSets", () => {
	test("percent change is null rather than a division by zero when A is zero", () => {
		expect(row("x", 0, 5)).toMatchObject({ change: 5, percent: null });
		expect(row("x", 4, 6)).toMatchObject({ change: 2, percent: 50 });
	});

	test("sets of different evals fail with a usage error", () => {
		const a = makeSet({ name: "a", parts: { hood: {} } });
		const b = makeSet({ evalName: "other", name: "b", parts: { hood: {} } });
		expect(() => assertSameEval(a, b)).toThrow(UsageError);
	});

	test("differing prompt hashes give a warning", () => {
		const a = makeSet({ name: "a", parts: { hood: {} }, prompt: "one" });
		const b = makeSet({ name: "b", parts: { hood: {} }, prompt: "two" });
		expect(compareSets(a, b, none).warnings).toHaveLength(1);
	});

	test("per-part rows hold both medians and the change", () => {
		const a = makeSet({ name: "a", parts: { hood: { calls: 4 } } });
		const b = makeSet({ name: "b", parts: { hood: { calls: 6 } } });
		const calls = compareSets(a, b, none).parts.find(
			(r) => r.label === "hood: calls",
		);
		expect(calls).toMatchObject({ a: 4, b: 6, change: 2, percent: 50 });
	});

	test("a new tool used in two of three runs shows 2/3, including as an apply op", () => {
		const a = makeSet({ name: "a", parts: { hood: {} } });
		const b = makeSet({
			name: "b",
			parts: { hood: {} },
			toolsPerRun: [
				["draw_shadow", "draw_shadow"],
				["draw_ellipse"],
				["draw_shadow"],
			],
		});
		const [tool] = compareSets(a, b, { newTools: ["draw.shadow"] }).newTools;
		expect(tool).toEqual({
			tool: "draw_shadow",
			runsUsing: 2,
			runs: 3,
			medianCalls: 1,
		});
	});

	test("--target splits the target from the sum of the other parts", () => {
		const a = makeSet({
			name: "a",
			parts: { hood: { calls: 2 }, boots: { calls: 3 }, other: { calls: 1 } },
		});
		const b = makeSet({
			name: "b",
			parts: { hood: { calls: 5 }, boots: { calls: 2 }, other: { calls: 1 } },
		});
		const rows = compareSets(a, b, { newTools: [], target: "hood" }).target;
		expect(rows.find((r) => r.label === "hood: calls")).toMatchObject({
			a: 2,
			b: 5,
			change: 3,
		});
		expect(rows.find((r) => r.label === "other parts: calls")).toMatchObject({
			a: 4,
			b: 3,
			change: -1,
		});
	});

	test("a target that is not a part fails with a usage error", () => {
		const a = makeSet({ name: "a", parts: { hood: {} } });
		const b = makeSet({ name: "b", parts: { hood: {} } });
		expect(() => compareSets(a, b, { newTools: [], target: "tail" })).toThrow(
			UsageError,
		);
	});

	test("MCP bytes change is B minus A, only with a flag", () => {
		const a = makeSet({ name: "a", parts: { hood: {} }, mcpBytes: 1000 });
		const b = makeSet({ name: "b", parts: { hood: {} }, mcpBytes: 1300 });
		expect(compareSets(a, b, none).mcpBytes).toBeUndefined();
		expect(
			compareSets(a, b, { newTools: ["draw_shadow"] }).mcpBytes,
		).toMatchObject({ a: 1000, b: 1300, change: 300 });
	});
});
