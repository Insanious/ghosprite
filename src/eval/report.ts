import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Ask, askClaude, assignParts } from "./assign.ts";
import type { EvalDefinition } from "./checks.ts";
import { type Effort, partEffort } from "./effort.ts";
import { extractItems, parseTranscript } from "./items.ts";
import type { ToolSchema } from "./metrics.ts";

export const REPO = resolve(dirname(import.meta.path), "..", "..");
export const EVALS = join(REPO, "evals");

export const OTHER = "other";

export async function loadEval(
	name: string,
): Promise<{ prompt: string; definition: EvalDefinition }> {
	const prompt = readFileSync(join(EVALS, name, "prompt.md"), "utf8");
	const definition = (await import(join(EVALS, name, "eval.ts")))
		.default as EvalDefinition;
	return { prompt, definition };
}

export type Spread = {
	median: number | null;
	min: number | null;
	max: number | null;
};

export function spread(values: (number | null | undefined)[]): Spread {
	const numbers = values
		.filter((v): v is number => typeof v === "number")
		.sort((a, b) => a - b);
	if (numbers.length === 0) return { median: null, min: null, max: null };
	const mid = numbers.length >> 1;
	const median =
		numbers.length % 2 === 1
			? (numbers[mid] as number)
			: ((numbers[mid - 1] as number) + (numbers[mid] as number)) / 2;
	return {
		median,
		min: numbers[0] as number,
		max: numbers.at(-1) as number,
	};
}

export type PartsFile = {
	classifier: string | null;
	items: {
		id: string;
		tool: string;
		note?: string;
		part: string;
		by: "keyword" | "model";
	}[];
	effort: Record<string, Effort>;
};

export function evalName(setFolder: string): string {
	return basename(dirname(resolve(setFolder)));
}

export function readJson<T>(path: string): T | undefined {
	return existsSync(path)
		? (JSON.parse(readFileSync(path, "utf8")) as T)
		: undefined;
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

export async function assignRun(
	runFolder: string,
	definition: EvalDefinition,
	prompt: string,
	tools: ToolSchema[],
	ask: Ask,
	force = false,
): Promise<boolean> {
	const partsPath = join(runFolder, "parts.json");
	const transcriptPath = join(runFolder, "transcript.jsonl");
	if (!existsSync(transcriptPath)) return false;
	if (existsSync(partsPath) && !force) return false;
	const extracted = extractItems(parseTranscript(transcriptPath), tools);
	const assignment = await assignParts(
		extracted.items,
		definition.parts,
		prompt,
		ask,
	);
	const partOf = new Map(assignment.items.map((a) => [a.id, a.part]));
	const file: PartsFile = {
		classifier: assignment.model,
		items: extracted.items.map((item, i) => ({
			id: item.id,
			tool: item.tool,
			note: item.note,
			part: partOf.get(item.id) ?? OTHER,
			by: assignment.items[i]?.by ?? "model",
		})),
		effort: partEffort(extracted, partOf, definition.parts),
	};
	writeJson(partsPath, file);
	return true;
}

type ChecksFile = {
	checks: { name: string; part: string; pass: boolean }[];
};
type MetricsFile = {
	requests: number;
	costUsd: number | null;
	tokens: { output: number | null };
};
type MetadataFile = { wallSeconds: number; mcp: { bytes: number } };

export type Report = {
	eval: string;
	runs: number;
	parts: Record<string, Record<keyof Effort, Spread>>;
	checks: Record<string, { part: string; passed: number; runs: number }>;
	totals: Record<
		"costUsd" | "requests" | "outputTokens" | "wallSeconds" | "mcpBytes",
		Spread
	>;
	runsWithoutParts: string[];
};

export const EFFORT_FIELDS: (keyof Effort)[] = [
	"calls",
	"errors",
	"outputTokens",
	"thinkingTokens",
	"renderRedraws",
	"redraws",
	"handPixelChars",
	"unknown",
	"chains",
];

export function listRuns(setFolder: string): string[] {
	return readdirSync(setFolder, { withFileTypes: true })
		.filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
		.map((e) => e.name)
		.sort((a, b) => Number(a) - Number(b));
}

export function buildReport(
	setFolder: string,
	definition: EvalDefinition,
): Report {
	const runs = listRuns(setFolder).map((name) => {
		const folder = join(setFolder, name);
		return {
			name,
			parts: readJson<PartsFile>(join(folder, "parts.json")),
			checks: readJson<ChecksFile>(join(folder, "checks.json")),
			metrics: readJson<MetricsFile>(join(folder, "metrics.json")),
			metadata: readJson<MetadataFile>(join(folder, "metadata.json")),
		};
	});
	const withParts = runs.flatMap((run) => (run.parts ? [run.parts] : []));

	const parts: Report["parts"] = {};
	for (const part of [...definition.parts, OTHER]) {
		const fields = {} as Record<keyof Effort, Spread>;
		for (const field of EFFORT_FIELDS) {
			fields[field] = spread(
				withParts.map((p) => p.effort[part]?.[field] ?? 0),
			);
		}
		parts[part] = fields;
	}

	const checks: Report["checks"] = {};
	for (const check of definition.checks) {
		const results = runs.flatMap((run) =>
			(run.checks?.checks ?? []).filter((c) => c.name === check.name),
		);
		checks[check.name] = {
			part: check.part,
			passed: results.filter((c) => c.pass).length,
			runs: results.length,
		};
	}

	return {
		eval: evalName(setFolder),
		runs: runs.length,
		parts,
		checks,
		totals: {
			costUsd: spread(runs.map((r) => r.metrics?.costUsd)),
			requests: spread(runs.map((r) => r.metrics?.requests)),
			outputTokens: spread(runs.map((r) => r.metrics?.tokens.output)),
			wallSeconds: spread(runs.map((r) => r.metadata?.wallSeconds)),
			mcpBytes: spread(runs.map((r) => r.metadata?.mcp.bytes)),
		},
		runsWithoutParts: runs.filter((r) => !r.parts).map((r) => r.name),
	};
}

function figure(value: number | null): string {
	return value === null ? "-" : String(Math.round(value));
}

function cell(stat: Spread): string {
	return `${figure(stat.median)} (${figure(stat.min)}–${figure(stat.max)})`;
}

export function formatReport(report: Report): string {
	const columns: [string, keyof Effort][] = [
		["calls", "calls"],
		["output", "outputTokens"],
		["thinking", "thinkingTokens"],
		["errors", "errors"],
		["redraws", "redraws"],
		["render-redraws", "renderRedraws"],
		["hand chars", "handPixelChars"],
	];
	const rows = [
		["part", ...columns.map(([title]) => title)],
		...Object.entries(report.parts).map(([part, fields]) => [
			part,
			...columns.map(([, field]) => cell(fields[field])),
		]),
	];
	const widths = (rows[0] ?? []).map((_, c) =>
		Math.max(...rows.map((row) => (row[c] ?? "").length)),
	);
	const lines = rows.map((row) =>
		row
			.map((text, c) => text.padEnd(widths[c] ?? 0))
			.join("  ")
			.trimEnd(),
	);
	lines.push("");
	for (const [name, check] of Object.entries(report.checks)) {
		lines.push(`${check.passed}/${check.runs}  ${name} (${check.part})`);
	}
	if (report.runsWithoutParts.length > 0) {
		lines.push(
			"",
			`Runs without parts.json: ${report.runsWithoutParts.join(", ")}`,
		);
	}
	return lines.join("\n");
}

export async function reportSet(
	setFolder: string,
	force: boolean,
	ask: Ask = askClaude,
): Promise<Report> {
	const { prompt, definition } = await loadEval(evalName(setFolder));
	const mcp = readJson<{ tools: ToolSchema[] }>(join(setFolder, "mcp.json"));
	const tools = mcp?.tools ?? [];
	for (const run of listRuns(setFolder)) {
		await assignRun(
			join(setFolder, run),
			definition,
			prompt,
			tools,
			ask,
			force,
		);
	}
	const report = buildReport(setFolder, definition);
	writeJson(join(setFolder, "report.json"), report);
	console.log(`${setFolder}\n${formatReport(report)}\n`);
	return report;
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { force: { type: "boolean", default: false } },
	});
	if (positionals.length === 0) {
		console.error("Usage: bun run eval-report <set folder>... [--force]");
		process.exit(2);
	}
	for (const set of positionals) await reportSet(set, values.force === true);
}

if (import.meta.main) await main();
