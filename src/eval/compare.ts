import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Effort } from "./effort.ts";
import {
	EFFORT_FIELDS,
	evalName,
	listRuns,
	type Report,
	readJson,
	reportSet,
	spread,
} from "./report.ts";

export class UsageError extends Error {}

export type Row = {
	label: string;
	a: number | null;
	b: number | null;
	change: number | null;
	percent: number | null;
};

export type CheckRow = {
	name: string;
	part: string;
	a: { passed: number; runs: number } | undefined;
	b: { passed: number; runs: number } | undefined;
};

export type ToolRow = {
	tool: string;
	runsUsing: number;
	runs: number;
	medianCalls: number | null;
};

export type Comparison = {
	eval: string;
	warnings: string[];
	parts: Row[];
	checks: CheckRow[];
	totals: Row[];
	newTools: ToolRow[];
	target: Row[];
	mcpBytes: Row | undefined;
};

export type CompareOptions = { newTools: string[]; target?: string };

const TARGET_FIELDS: (keyof Effort)[] = [
	"calls",
	"outputTokens",
	"thinkingTokens",
	"errors",
	"redraws",
];

export function row(label: string, a: number | null, b: number | null): Row {
	const change = a === null || b === null ? null : b - a;
	const percent =
		change === null || a === 0 ? null : (change / (a as number)) * 100;
	return { label, a, b, change, percent };
}

function promptHashes(setFolder: string): string[] {
	return listRuns(setFolder).flatMap((run) => {
		const metadata = readJson<{ promptSha256?: string }>(
			join(setFolder, run, "metadata.json"),
		);
		return metadata?.promptSha256 ? [metadata.promptSha256] : [];
	});
}

function toolCallCounts(setFolder: string, tool: string): number[] {
	return listRuns(setFolder).flatMap((run) => {
		const parts = readJson<{ items: { tool: string }[] }>(
			join(setFolder, run, "parts.json"),
		);
		return parts ? [parts.items.filter((i) => i.tool === tool).length] : [];
	});
}

export function assertSameEval(setA: string, setB: string): void {
	if (evalName(setA) !== evalName(setB)) {
		throw new UsageError(
			`The sets belong to different evals: ${evalName(setA)} and ${evalName(setB)}`,
		);
	}
}

export function compareSets(
	setA: string,
	setB: string,
	options: CompareOptions,
): Comparison {
	const name = evalName(setA);
	const load = (set: string): Report => {
		const report = readJson<Report>(join(set, "report.json"));
		if (!report) throw new Error(`${set} has no report.json`);
		return report;
	};
	const reportA = load(setA);
	const reportB = load(setB);
	const { target } = options;
	if (target !== undefined && !(target in reportA.parts)) {
		throw new UsageError(
			`--target ${target} is not a part of ${name}: ${Object.keys(reportA.parts).join(", ")}`,
		);
	}

	const warnings: string[] = [];
	if (new Set([...promptHashes(setA), ...promptHashes(setB)]).size > 1) {
		warnings.push("The runs were made with different prompts (promptSha256).");
	}

	const medianOf = (report: Report, part: string, field: keyof Effort) =>
		report.parts[part]?.[field].median ?? null;

	const parts: Row[] = [];
	for (const part of Object.keys(reportA.parts)) {
		for (const field of EFFORT_FIELDS) {
			parts.push(
				row(
					`${part}: ${field}`,
					medianOf(reportA, part, field),
					medianOf(reportB, part, field),
				),
			);
		}
	}

	const checks: CheckRow[] = Object.entries(reportA.checks).map(
		([checkName, check]) => ({
			name: checkName,
			part: check.part,
			a: check,
			b: reportB.checks[checkName],
		}),
	);

	const totals = (
		["costUsd", "requests", "outputTokens", "wallSeconds"] as const
	).map((key) =>
		row(key, reportA.totals[key].median, reportB.totals[key].median),
	);

	const newTools = options.newTools.map((raw): ToolRow => {
		const tool = raw.replaceAll(".", "_");
		const counts = toolCallCounts(setB, tool);
		return {
			tool,
			runsUsing: counts.filter((n) => n > 0).length,
			runs: counts.length,
			medianCalls: spread(counts).median,
		};
	});

	const targetRows: Row[] = [];
	if (target !== undefined) {
		const others = Object.keys(reportA.parts).filter((p) => p !== target);
		for (const field of TARGET_FIELDS) {
			const sum = (report: Report) =>
				others.reduce((n, p) => n + (medianOf(report, p, field) ?? 0), 0);
			targetRows.push(
				row(
					`${target}: ${field}`,
					medianOf(reportA, target, field),
					medianOf(reportB, target, field),
				),
				row(`other parts: ${field}`, sum(reportA), sum(reportB)),
			);
		}
	}

	const flagged = options.newTools.length > 0 || target !== undefined;
	return {
		eval: name,
		warnings,
		parts,
		checks,
		totals,
		newTools,
		target: targetRows,
		mcpBytes: flagged
			? row(
					"MCP bytes",
					reportA.totals.mcpBytes.median,
					reportB.totals.mcpBytes.median,
				)
			: undefined,
	};
}

function figure(value: number | null): string {
	if (value === null) return "-";
	return String(
		Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(2)),
	);
}

function signed(value: number | null, suffix = ""): string {
	if (value === null) return "-";
	return `${value > 0 ? "+" : ""}${figure(value)}${suffix}`;
}

function table(header: string[], rows: string[][]): string {
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [line(header), line(header.map(() => "---")), ...rows.map(line)].join(
		"\n",
	);
}

function rowTable(first: string, rows: Row[]): string {
	return table(
		[first, "A", "B", "change", "%"],
		rows.map((r) => [
			r.label,
			figure(r.a),
			figure(r.b),
			signed(r.change),
			signed(r.percent, "%"),
		]),
	);
}

export function formatComparison(c: Comparison): string {
	const rate = (r: { passed: number; runs: number } | undefined) =>
		r ? `${r.passed}/${r.runs}` : "-";
	const sections = [
		...c.warnings.map((w) => `Warning: ${w}`),
		`## Effort per part (medians)\n\n${rowTable("part: field", c.parts)}`,
		`## Checks passed\n\n${table(
			["check", "part", "A", "B"],
			c.checks.map((k) => [k.name, k.part, rate(k.a), rate(k.b)]),
		)}`,
		`## Run totals (medians)\n\n${rowTable("total", c.totals)}`,
	];
	if (c.newTools.length > 0) {
		sections.push(
			`## New tools in B\n\n${table(
				["tool", "runs using it", "median calls per run"],
				c.newTools.map((t) => [
					t.tool,
					`${t.runsUsing}/${t.runs}`,
					figure(t.medianCalls),
				]),
			)}`,
		);
	}
	if (c.target.length > 0) {
		sections.push(
			`## Target part against the rest\n\n${rowTable("", c.target)}`,
		);
	}
	if (c.mcpBytes) sections.push(`## MCP size\n\n${rowTable("", [c.mcpBytes])}`);
	return sections.join("\n\n");
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			"new-tool": { type: "string", multiple: true },
			target: { type: "string" },
		},
	});
	try {
		const [setA, setB] = positionals;
		if (positionals.length !== 2 || !setA || !setB) {
			throw new UsageError(
				"Usage: bun run eval-compare <set A> <set B> [--new-tool <name>]... [--target <part>]",
			);
		}
		assertSameEval(setA, setB);
		for (const set of [setA, setB]) {
			if (!existsSync(join(set, "report.json"))) await reportSet(set, false);
		}
		console.log(
			formatComparison(
				compareSets(setA, setB, {
					newTools: values["new-tool"] ?? [],
					target: values.target,
				}),
			),
		);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(error.message);
		process.exit(2);
	}
}

if (import.meta.main) await main();
