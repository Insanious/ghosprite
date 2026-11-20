import type { LogEntry } from "../session.ts";

export type ToolSchema = { name: string; inputSchema: unknown };

export type Metrics = {
	requests: number;
	tokens: {
		input: number;
		cacheWrite: number;
		cacheRead: number;
		output: number | null;
	};
	costUsd: number | null;
	toolCalls: Record<string, number>;
	toolErrors: Record<string, number>;
	unknownTools: string[];
	unknownOptions: { tool: string; path: string }[];
	retriesAfterError: number;
	renders: number;
	undo: number;
	redo: number;
	restore: number;
	bash: { calls: number; commands: string[] };
	steps: number;
	stepsWithoutNote: number;
};

type Json = Record<string, unknown>;
type Call = { id: string; name: string; input: unknown };
type Result = { isError: boolean; text: string; hasImage: boolean };

const MCP_PREFIX = "mcp__ghosprite__";
const CLAUDE_CODE_ERROR = "claude_code";

export function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shortName(name: string): string {
	return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}

function count(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
}

export function blocks(line: Json): Json[] {
	const message = line.message;
	if (!isObject(message) || !Array.isArray(message.content)) return [];
	return message.content.filter(isObject);
}

export function readResult(block: Json): Result {
	const content = block.content;
	const parts = Array.isArray(content) ? content.filter(isObject) : [];
	const firstText = parts.find((part) => part.type === "text")?.text;
	const text =
		typeof content === "string"
			? content
			: typeof firstText === "string"
				? firstText
				: "";
	return {
		isError: block.is_error === true,
		text,
		hasImage: parts.some((part) => part.type === "image"),
	};
}

function errorCode(text: string): string {
	try {
		const parsed: unknown = JSON.parse(text);
		if (
			isObject(parsed) &&
			typeof parsed.code === "string" &&
			typeof parsed.message === "string"
		) {
			return parsed.code;
		}
	} catch {
		// Not JSON: Claude Code's own rejection.
	}
	return CLAUDE_CODE_ERROR;
}

function bestBranch(branches: unknown[], value: Json): Json | undefined {
	let best: Json | undefined;
	let bestScore = -1;
	for (const branch of branches) {
		if (!isObject(branch)) continue;
		const declared = isObject(branch.properties) ? branch.properties : {};
		const score = Object.keys(value).filter((key) => key in declared).length;
		const isObjectBranch =
			branch.properties !== undefined ||
			branch.additionalProperties !== undefined;
		if (isObjectBranch && score > bestScore) {
			best = branch;
			bestScore = score;
		}
	}
	return best;
}

export function findUnknown(
	schema: unknown,
	value: unknown,
	path: string,
): string[] {
	if (!isObject(schema)) return [];
	if (Array.isArray(schema.anyOf)) {
		if (!isObject(value)) return [];
		const branch = bestBranch(schema.anyOf, value);
		return branch ? findUnknown(branch, value, path) : [];
	}
	const join = (key: string | number) => (path ? `${path}.${key}` : `${key}`);
	if (Array.isArray(value)) {
		return value.flatMap((item, i) => findUnknown(schema.items, item, join(i)));
	}
	if (!isObject(value)) return [];
	const properties = isObject(schema.properties)
		? schema.properties
		: undefined;
	const extra = schema.additionalProperties;
	if (!properties && !isObject(extra)) return [];
	return Object.entries(value).flatMap(([key, child]) => {
		if (properties && key in properties) {
			return findUnknown(properties[key], child, join(key));
		}
		if (isObject(extra)) return findUnknown(extra, child, join(key));
		return extra === true ? [] : [join(key)];
	});
}

// Per-request output_tokens on assistant lines are start-of-stream values, so
// only the result line holds real output totals.
export function resultTokens(
	events: unknown[],
): { output: number; thinking: number } | undefined {
	const last = events.filter(isObject).findLast((e) => e.type === "result");
	const usage = last && isObject(last.usage) ? last.usage : undefined;
	if (!usage || typeof usage.output_tokens !== "number") return undefined;
	const details = isObject(usage.output_tokens_details)
		? usage.output_tokens_details
		: {};
	const thinking =
		typeof details.thinking_tokens === "number" ? details.thinking_tokens : 0;
	return { output: usage.output_tokens, thinking };
}

export function computeMetrics(
	events: unknown[],
	tools: ToolSchema[],
	log: LogEntry[],
): Metrics {
	const lines = events.filter(isObject);
	const schemas = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
	const listed = new Set<string>();
	const usageById = new Map<string, Json>();
	const calls: Call[] = [];
	const results = new Map<string, Result>();
	let costUsd: number | null = null;

	for (const line of lines) {
		if (line.type === "system" && line.subtype === "init") {
			for (const name of Array.isArray(line.tools) ? line.tools : []) {
				if (typeof name === "string") listed.add(name);
			}
		} else if (line.type === "result") {
			if (typeof line.total_cost_usd === "number")
				costUsd = line.total_cost_usd;
		} else if (line.type === "assistant") {
			const message = isObject(line.message) ? line.message : {};
			if (typeof message.id === "string" && !usageById.has(message.id)) {
				usageById.set(message.id, isObject(message.usage) ? message.usage : {});
			}
			for (const block of blocks(line)) {
				if (block.type === "tool_use" && typeof block.name === "string") {
					calls.push({
						id: String(block.id),
						name: block.name,
						input: block.input,
					});
				}
			}
		} else if (line.type === "user") {
			for (const block of blocks(line)) {
				if (block.type === "tool_result") {
					results.set(String(block.tool_use_id), readResult(block));
				}
			}
		}
	}

	const tokens = {
		input: 0,
		cacheWrite: 0,
		cacheRead: 0,
		output: resultTokens(events)?.output ?? null,
	};
	const number = (usage: Json, key: string) =>
		typeof usage[key] === "number" ? usage[key] : 0;
	for (const usage of usageById.values()) {
		tokens.input += number(usage, "input_tokens");
		tokens.cacheWrite += number(usage, "cache_creation_input_tokens");
		tokens.cacheRead += number(usage, "cache_read_input_tokens");
	}

	const toolCalls: Record<string, number> = {};
	const unknownTools: string[] = [];
	const unknownOptions: { tool: string; path: string }[] = [];
	const commands: string[] = [];
	for (const call of calls) {
		const name = shortName(call.name);
		count(toolCalls, name);
		if (!listed.has(call.name)) unknownTools.push(call.name);
		if (name === "Bash" && isObject(call.input)) {
			commands.push(String(call.input.command ?? ""));
		}
		const flag = (path: string) => unknownOptions.push({ tool: name, path });
		for (const path of findUnknown(schemas.get(name), call.input, ""))
			flag(path);
		if (name === "session_apply" && isObject(call.input)) {
			const ops = Array.isArray(call.input.ops) ? call.input.ops : [];
			ops.forEach((entry, i) => {
				if (!isObject(entry) || typeof entry.op !== "string") return;
				const schema = schemas.get(entry.op.replaceAll(".", "_"));
				if (!schema) {
					unknownTools.push(entry.op);
					return;
				}
				for (const path of findUnknown(schema, entry.input, `ops.${i}.input`)) {
					flag(path);
				}
			});
		}
	}

	const toolErrors: Record<string, number> = {};
	let renders = 0;
	for (const result of results.values()) {
		if (result.isError) count(toolErrors, errorCode(result.text));
		if (result.hasImage) renders++;
	}

	let retriesAfterError = 0;
	for (let i = 1; i < calls.length; i++) {
		const previous = calls[i - 1] as Call;
		if (calls[i]?.name === previous.name && results.get(previous.id)?.isError) {
			retriesAfterError++;
		}
	}

	const steps = log.filter((entry) => entry.kind === "step");
	return {
		requests: usageById.size,
		tokens,
		costUsd,
		toolCalls,
		toolErrors,
		unknownTools,
		unknownOptions,
		retriesAfterError,
		renders,
		undo: toolCalls.session_undo ?? 0,
		redo: toolCalls.session_redo ?? 0,
		restore: toolCalls.session_restore ?? 0,
		bash: { calls: commands.length, commands },
		steps: steps.length,
		stepsWithoutNote: steps.filter((entry) => entry.note === undefined).length,
	};
}
