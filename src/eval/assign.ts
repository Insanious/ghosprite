import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "./items.ts";
import { isObject } from "./metrics.ts";

export type Assignment = {
	model: string | null;
	items: { id: string; part: string; by: "keyword" | "model" }[];
};

export type Ask = (
	prompt: string,
	schema: unknown,
) => Promise<{ answer: unknown; model: string }>;

export const CLAUDE_ENV = {
	CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
	CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
};

const OTHER = "other";
const BATCH = 100;
const TEXT_LIMIT = 300;
const LONG_STRING = 40;
const LONG_ARRAY = 8;

function words(text: string): string[] {
	return text.toLowerCase().split(/[^\p{L}\p{N}-]+/u);
}

function keywords(part: string): string[] {
	return words(part)
		.filter((word) => word.length >= 4)
		.map((word) => word.replace(/s$/, ""));
}

export function keywordPart(item: Item, parts: string[]): string | undefined {
	const textWords = words(item.note ?? item.label ?? "");
	const matching = parts.filter((part) =>
		keywords(part).some((keyword) =>
			textWords.some((word) => word.startsWith(keyword)),
		),
	);
	return matching.length === 1 ? matching[0] : undefined;
}

function elide(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length > LONG_STRING
			? `${value.slice(0, LONG_STRING)}… (${value.length} chars)`
			: value;
	}
	if (Array.isArray(value)) {
		return value.length > LONG_ARRAY
			? `[${value.length} items]`
			: value.map(elide);
	}
	if (isObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, elide(entry)]),
		);
	}
	return value;
}

function cut(text: string): string {
	return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text;
}

function describeItem(
	item: Item,
	index: number,
	assigned: string | undefined,
): string {
	const fields = [
		`tool: ${item.tool}`,
		item.note === undefined ? "" : `note: ${item.note}`,
		item.label === undefined ? "" : `label: ${item.label}`,
		item.text === "" ? "" : `text: ${cut(item.text)}`,
		`input: ${cut(JSON.stringify(elide(item.input)))}`,
		assigned === undefined ? "" : `part (already assigned): ${assigned}`,
	];
	return `${index}. ${fields.filter((field) => field !== "").join(" | ")}`;
}

function classifierSchema(parts: string[]): unknown {
	return {
		type: "object",
		properties: {
			parts: {
				type: "array",
				items: {
					type: "object",
					properties: {
						index: { type: "number" },
						part: { type: "string", enum: [...parts, OTHER] },
					},
					required: ["index", "part"],
				},
			},
		},
		required: ["parts"],
	};
}

function classifierPrompt(
	evalPrompt: string,
	parts: string[],
	items: Item[],
	assigned: (string | undefined)[],
	batch: number[],
): string {
	return [
		"An agent was given the drawing prompt below and made the numbered tool calls listed after it. Decide which part of the sprite each listed call draws or works on.",
		`Prompt:\n${evalPrompt}`,
		`Parts: ${[...parts, OTHER].join(", ")}. Use "other" for calls that belong to no single part, such as setup, inspection or the whole sprite.`,
		`Calls, in order:\n${items.map((item, i) => describeItem(item, i, assigned[i])).join("\n")}`,
		`Give a part for each of these indexes: ${batch.join(", ")}.`,
	].join("\n\n");
}

function answeredParts(answer: unknown, parts: string[]): Map<number, string> {
	const result = new Map<number, string>();
	const list = isObject(answer) ? answer.parts : undefined;
	if (!Array.isArray(list)) return result;
	for (const entry of list) {
		if (
			isObject(entry) &&
			typeof entry.index === "number" &&
			typeof entry.part === "string" &&
			parts.includes(entry.part)
		) {
			result.set(entry.index, entry.part);
		}
	}
	return result;
}

export async function assignParts(
	items: Item[],
	parts: string[],
	prompt: string,
	ask: Ask,
): Promise<Assignment> {
	const assigned = items.map((item) => keywordPart(item, parts));
	const unassigned = assigned.flatMap((part, i) =>
		part === undefined ? [i] : [],
	);
	const byModel = new Map<number, string>();
	let model: string | null = null;
	for (let start = 0; start < unassigned.length; start += BATCH) {
		const batch = unassigned.slice(start, start + BATCH);
		const reply = await ask(
			classifierPrompt(prompt, parts, items, assigned, batch),
			classifierSchema(parts),
		);
		model = reply.model;
		const answered = answeredParts(reply.answer, [...parts, OTHER]);
		for (const index of batch) byModel.set(index, answered.get(index) ?? OTHER);
	}
	return {
		model,
		items: items.map((item, i) => {
			const keyword = assigned[i];
			return keyword === undefined
				? { id: item.id, part: byModel.get(i) ?? OTHER, by: "model" }
				: { id: item.id, part: keyword, by: "keyword" };
		}),
	};
}

export async function askClaude(
	prompt: string,
	schema: unknown,
	model = "haiku",
): Promise<{ answer: unknown; model: string }> {
	const cwd = mkdtempSync(join(tmpdir(), "ghosprite-assign-"));
	try {
		const child = Bun.spawn(
			[
				"claude",
				"-p",
				"--model",
				model,
				"--output-format",
				"json",
				"--json-schema",
				JSON.stringify(schema),
				"--tools",
				"",
				"--setting-sources",
				"",
				"--strict-mcp-config",
				"--no-session-persistence",
				"--disable-slash-commands",
			],
			{
				cwd,
				env: { ...process.env, ...CLAUDE_ENV },
				stdin: Buffer.from(prompt),
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`claude exited with ${code}: ${stderr}`);
		const parsed: unknown = JSON.parse(stdout);
		if (!isObject(parsed) || parsed.structured_output === undefined) {
			throw new Error(`claude gave no structured_output: ${stderr || stdout}`);
		}
		const models = isObject(parsed.modelUsage)
			? Object.keys(parsed.modelUsage)
			: [];
		return { answer: parsed.structured_output, model: models[0] ?? "unknown" };
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

export const askOpus: Ask = (prompt, schema) =>
	askClaude(prompt, schema, "opus");
