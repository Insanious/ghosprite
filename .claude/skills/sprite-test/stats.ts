// Prints time, tokens, tool calls and models for each prompt in a Claude Code session transcript.
// A turn is counted up to the result of its last ghosprite call, so writing the run record
// afterwards, and entries logged while idle, don't count. A turn with no ghosprite call is
// counted up to its last assistant message.
// Usage: bun .claude/skills/sprite-test/stats.ts [session.jsonl]
// Without a path it reads the newest transcript of the project in the working directory.

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Usage = {
	input_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	output_tokens: number;
};

type Block = { type: string; id?: string; name?: string; tool_use_id?: string };

type Entry = {
	type: string;
	timestamp?: string;
	isMeta?: boolean;
	isSidechain?: boolean;
	message?: {
		id?: string;
		model?: string;
		usage?: Usage;
		content?: string | Block[];
	};
};

type Turn = {
	prompt: string;
	start: Date;
	entries: Entry[];
};

function newestTranscript(): string {
	const dir = join(
		homedir(),
		".claude/projects",
		process.cwd().replaceAll("/", "-"),
	);
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.map((name) => join(dir, name));
	const newest = files.sort(
		(a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
	)[0];
	if (!newest) throw new Error(`No transcripts in ${dir}`);
	return newest;
}

function blocks(entry: Entry): Block[] {
	const content = entry.message?.content;
	return Array.isArray(content) ? content : [];
}

function endIndex(turn: Turn): number {
	const ghospriteCalls = new Set(
		turn.entries.flatMap((entry) =>
			blocks(entry)
				.filter(
					(block) =>
						block.type === "tool_use" &&
						block.name?.startsWith("mcp__ghosprite__"),
				)
				.map((block) => block.id),
		),
	);
	const lastResult = turn.entries.findLastIndex((entry) =>
		blocks(entry).some(
			(block) =>
				block.type === "tool_result" && ghospriteCalls.has(block.tool_use_id),
		),
	);
	if (lastResult !== -1) return lastResult;
	return turn.entries.findLastIndex((entry) => entry.type === "assistant");
}

const path = process.argv[2] ?? newestTranscript();
console.log(path);

const entries: Entry[] = (await Bun.file(path).text())
	.split("\n")
	.filter((line) => line.trim() !== "")
	.map((line) => JSON.parse(line));

const turns: Turn[] = [];
for (const entry of entries) {
	if (!entry.timestamp) continue;
	const content = entry.message?.content;
	if (
		entry.type === "user" &&
		!entry.isMeta &&
		typeof content === "string" &&
		!content.startsWith("<local-command")
	) {
		turns.push({
			prompt: content.replace(/\s+/g, " ").slice(0, 60),
			start: new Date(entry.timestamp),
			entries: [],
		});
		continue;
	}
	turns.at(-1)?.entries.push(entry);
}

turns.forEach((turn, i) => {
	const counted = turn.entries.slice(0, endIndex(turn) + 1);
	const last = counted.at(-1)?.timestamp;
	const end = last ? new Date(last) : turn.start;
	const models = new Set<string>();
	// Assistant messages are logged once per content block, so usage is keyed by message id.
	const usage = new Map<string, Usage>();
	const toolCalls = new Set<string>();
	for (const entry of counted) {
		const message = entry.message;
		if (entry.type !== "assistant" || !message?.id || !message.usage) continue;
		if (message.model) models.add(message.model);
		usage.set(message.id, message.usage);
		for (const block of blocks(entry)) {
			if (block.type === "tool_use" && block.id) toolCalls.add(block.id);
		}
	}

	const usages = [...usage.values()];
	const sum = (pick: (u: Usage) => number) =>
		usages.reduce((total, u) => total + pick(u), 0);
	const seconds = Math.round((end.getTime() - turn.start.getTime()) / 1000);
	console.log(`Turn ${i + 1}: "${turn.prompt}"`);
	console.log(`  started    ${turn.start.toISOString()}`);
	console.log(`  duration   ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
	console.log(`  models     ${[...models].join(", ") || "-"}`);
	console.log(`  requests   ${usages.length}`);
	console.log(`  tool calls ${toolCalls.size}`);
	console.log(`  output     ${sum((u) => u.output_tokens)} tokens`);
	console.log(
		`  input      ${sum((u) => u.input_tokens)} uncached, ${sum((u) => u.cache_creation_input_tokens)} cache write, ${sum((u) => u.cache_read_input_tokens)} cache read`,
	);
});
