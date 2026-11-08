// Prints time, tokens, tool calls and models for each prompt in a Claude Code session transcript.
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

type Entry = {
	type: string;
	timestamp?: string;
	isMeta?: boolean;
	isSidechain?: boolean;
	message?: {
		id?: string;
		model?: string;
		usage?: Usage;
		content?: string | { type: string; id?: string }[];
	};
};

type Turn = {
	prompt: string;
	start: Date;
	end: Date;
	models: Set<string>;
	usage: Map<string, Usage>;
	toolCalls: Set<string>;
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

const path = process.argv[2] ?? newestTranscript();
console.log(path);

const entries: Entry[] = (await Bun.file(path).text())
	.split("\n")
	.filter((line) => line.trim() !== "")
	.map((line) => JSON.parse(line));

// Assistant messages are logged once per content block, so usage is keyed by message id.
const turns: Turn[] = [];
for (const entry of entries) {
	if (!entry.timestamp) continue;
	const time = new Date(entry.timestamp);
	const content = entry.message?.content;
	if (
		entry.type === "user" &&
		!entry.isMeta &&
		typeof content === "string" &&
		!content.startsWith("<local-command")
	) {
		turns.push({
			prompt: content.replace(/\s+/g, " ").slice(0, 60),
			start: time,
			end: time,
			models: new Set(),
			usage: new Map(),
			toolCalls: new Set(),
		});
		continue;
	}
	const turn = turns.at(-1);
	if (!turn) continue;
	turn.end = time;
	const message = entry.message;
	if (entry.type !== "assistant" || !message?.id || !message.usage) continue;
	if (message.model) turn.models.add(message.model);
	turn.usage.set(message.id, message.usage);
	if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === "tool_use" && block.id) turn.toolCalls.add(block.id);
		}
	}
}

turns.forEach((turn, i) => {
	const usages = [...turn.usage.values()];
	const sum = (pick: (u: Usage) => number) =>
		usages.reduce((total, u) => total + pick(u), 0);
	const seconds = Math.round(
		(turn.end.getTime() - turn.start.getTime()) / 1000,
	);
	console.log(`Turn ${i + 1}: "${turn.prompt}"`);
	console.log(`  started    ${turn.start.toISOString()}`);
	console.log(`  duration   ${Math.floor(seconds / 60)}m ${seconds % 60}s`);
	console.log(`  models     ${[...turn.models].join(", ") || "-"}`);
	console.log(`  requests   ${usages.length}`);
	console.log(`  tool calls ${turn.toolCalls.size}`);
	console.log(`  output     ${sum((u) => u.output_tokens)} tokens`);
	console.log(
		`  input      ${sum((u) => u.input_tokens)} uncached, ${sum((u) => u.cache_creation_input_tokens)} cache write, ${sum((u) => u.cache_read_input_tokens)} cache read`,
	);
});
