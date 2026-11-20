import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Ask, askOpus } from "./assign.ts";
import type { EvalDefinition } from "./checks.ts";
import { extractItems, type Item, parseTranscript } from "./items.ts";
import { isObject, type ToolSchema } from "./metrics.ts";
import {
	evalName,
	listRuns,
	loadEval,
	OTHER,
	type PartsFile,
	readJson,
} from "./report.ts";

type Mcp = { instructions?: string; tools: ToolSchema[] };

export type Finding = {
	part: string;
	work: string;
	kind: "missing" | "exists";
	tool: string;
	tools?: string[];
	calls: string[];
	effort: { calls: number; outputTokens: number };
};

export type FrictionFile = {
	analyst: string;
	dropped: number;
	findings: Finding[];
	callTokens: Record<string, number>;
};

function schema(parts: string[]): unknown {
	return {
		type: "object",
		properties: {
			findings: {
				type: "array",
				items: {
					type: "object",
					properties: {
						part: { type: "string", enum: parts },
						work: { type: "string" },
						calls: { type: "array", items: { type: "string" } },
						kind: { type: "string", enum: ["missing", "exists"] },
						tool: { type: "string" },
						tools: { type: "array", items: { type: "string" } },
					},
					required: ["part", "work", "calls", "kind", "tool"],
				},
			},
		},
		required: ["findings"],
	};
}

function describeItem(item: Item, part: string): string {
	return JSON.stringify({
		id: item.id,
		part,
		tool: item.tool,
		note: item.note,
		label: item.label,
		textBefore: item.text,
		input: item.input,
		error: item.errorText,
	});
}

function analysisPrompt(
	evalPrompt: string,
	parts: string[],
	mcp: Mcp,
	items: Item[],
	partOf: Map<string, string>,
): string {
	const tools = mcp.tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
	return [
		'An agent was given the drawing prompt below and drew a sprite with the ghosprite tools. Find work the agent worked out or made by hand that a tool could have done. Examples: counting or placing pixels for a shape, working out the coordinates of an angled shape, building a soft edge from stacked shapes, or retrying after errors. Each finding has a kind. Kind "missing": a tool or option ghosprite does not have would have removed the work, and tool names that tool or option. Kind "exists": one or more of the listed MCP tools would have done the work had the agent used them, tools lists those tool names spelled exactly as in the MCP tool list, and tool says in a short phrase how they would have done it (for example "draw_ellipse with filled: true"). Each finding also names the part, what the agent worked out or made by hand, and the ids of the calls that show the work. Cite ids exactly as given. Ids of ops inside a session_apply look like <id>#<n>. If nothing qualifies, return no findings.',
		`Prompt:\n${evalPrompt}`,
		`Parts: ${[...parts, OTHER].join(", ")}`,
		`MCP instructions:\n${mcp.instructions ?? "(none recorded)"}`,
		`MCP tools:\n${JSON.stringify(tools)}`,
		`Calls, in order, one JSON object per line:\n${items.map((item) => describeItem(item, partOf.get(item.id) ?? OTHER)).join("\n")}`,
	].join("\n\n");
}

export async function analyseRun(
	runFolder: string,
	definition: EvalDefinition,
	prompt: string,
	mcp: Mcp,
	ask: Ask,
	force = false,
): Promise<boolean> {
	const transcriptPath = join(runFolder, "transcript.jsonl");
	const findingsPath = join(runFolder, "findings.json");
	if (!existsSync(transcriptPath)) return false;
	if (existsSync(findingsPath) && !force) return false;
	const partsFile = readJson<PartsFile>(join(runFolder, "parts.json"));
	if (!partsFile) {
		console.error(`${runFolder}: no parts.json, run eval-report first`);
		return false;
	}
	const { items } = extractItems(parseTranscript(transcriptPath), mcp.tools);
	const partOf = new Map(partsFile.items.map((i) => [i.id, i.part]));
	const parts = [...definition.parts, OTHER];
	const reply = await ask(
		analysisPrompt(prompt, definition.parts, mcp, items, partOf),
		schema(parts),
	);

	const tokens = new Map(items.map((item) => [item.id, item.outputTokens]));
	const list = isObject(reply.answer) ? reply.answer.findings : undefined;
	const findings: Finding[] = [];
	const callTokens: Record<string, number> = {};
	const toolNames = new Set(mcp.tools.map((tool) => tool.name));
	let dropped = 0;
	for (const entry of Array.isArray(list) ? list : []) {
		const calls =
			isObject(entry) && Array.isArray(entry.calls)
				? entry.calls.filter((c): c is string => typeof c === "string")
				: [];
		if (
			!isObject(entry) ||
			typeof entry.part !== "string" ||
			!parts.includes(entry.part) ||
			typeof entry.work !== "string" ||
			typeof entry.tool !== "string" ||
			(entry.kind !== "missing" && entry.kind !== "exists") ||
			calls.length === 0 ||
			!calls.every((id) => tokens.has(id))
		) {
			dropped++;
			continue;
		}
		let tools: string[] | undefined;
		if (entry.kind === "exists") {
			const named: unknown = entry.tools;
			if (
				!Array.isArray(named) ||
				named.length === 0 ||
				!named.every((n) => typeof n === "string" && toolNames.has(n))
			) {
				dropped++;
				continue;
			}
			tools = [...new Set<string>(named)];
		}
		const distinct = [...new Set(calls)];
		for (const id of distinct) callTokens[id] = tokens.get(id) ?? 0;
		findings.push({
			part: entry.part,
			work: entry.work,
			kind: entry.kind,
			tool: entry.tool,
			...(tools ? { tools } : {}),
			calls: distinct,
			effort: {
				calls: distinct.length,
				outputTokens: distinct.reduce(
					(sum, id) => sum + (tokens.get(id) ?? 0),
					0,
				),
			},
		});
	}
	const file: FrictionFile = {
		analyst: reply.model,
		dropped,
		findings,
		callTokens,
	};
	writeFileSync(findingsPath, `${JSON.stringify(file, null, "\t")}\n`);
	return true;
}

export async function analyseSet(
	setFolder: string,
	force: boolean,
	ask: Ask = askOpus,
): Promise<void> {
	const { prompt, definition } = await loadEval(evalName(setFolder));
	const mcp = readJson<Mcp>(join(setFolder, "mcp.json")) ?? { tools: [] };
	for (const run of listRuns(setFolder)) {
		const done = await analyseRun(
			join(setFolder, run),
			definition,
			prompt,
			mcp,
			ask,
			force,
		);
		if (done) console.log(`${join(setFolder, run)}: findings.json written`);
	}
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: { force: { type: "boolean", default: false } },
	});
	if (positionals.length === 0) {
		console.error("Usage: bun run eval-friction <set folder>... [--force]");
		process.exit(2);
	}
	for (const set of positionals) await analyseSet(set, values.force === true);
}

if (import.meta.main) await main();
