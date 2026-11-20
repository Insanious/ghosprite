import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Sprite } from "../core/index.ts";
import { listRuns } from "../history-dir.ts";
import { type Replay, readRun, replayRun } from "../run-replay.ts";
import { type LogEntry, Session } from "../session.ts";
import { callTool } from "../tools.ts";
import { CLAUDE_ENV } from "./assign.ts";
import { type EvalDefinition, runChecks } from "./checks.ts";
import { computeMetrics, type ToolSchema } from "./metrics.ts";

const REPO = resolve(dirname(import.meta.path), "..", "..");
const EVALS = join(REPO, "evals");
const CLI = join(REPO, "src", "cli.ts");

export type Caps = { maxTurns: number; maxBudgetUsd: number; minutes: number };
export type Capped = "turns" | "budget" | "time" | null;

export function mcpServerArgs(historyFlag: string[]): string[] {
	return [CLI, "mcp", "--no-viewer", ...historyFlag];
}

export function claudeArgs(
	prompt: string,
	model: string,
	caps: Caps,
	runFolder: string,
): string[] {
	const mcpConfig = JSON.stringify({
		mcpServers: {
			ghosprite: {
				command: "bun",
				args: mcpServerArgs(["--history", join(runFolder, "ghosprite")]),
			},
		},
	});
	return [
		"-p",
		prompt,
		"--model",
		model,
		"--output-format",
		"stream-json",
		"--verbose",
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--mcp-config",
		mcpConfig,
		"--disable-slash-commands",
		"--tools",
		"Bash",
		"--allowedTools",
		"Bash",
		"mcp__ghosprite",
		"--permission-prompts",
		"none",
		"--no-session-persistence",
		"--max-turns",
		String(caps.maxTurns),
		"--max-budget-usd",
		String(caps.maxBudgetUsd),
	];
}

export function classifyCap(subtype: unknown, killed: boolean): Capped {
	if (killed) return "time";
	if (subtype === "error_max_turns") return "turns";
	if (subtype === "error_max_budget_usd") return "budget";
	return null;
}

export function setFolder(
	resultsDir: string,
	name: string,
	date: string,
	model: string,
	commit: string,
): string {
	const base = join(resultsDir, name, `${date}-${model}-${commit}`);
	let folder = base;
	for (let n = 2; existsSync(folder); n++) folder = `${base}-${n}`;
	return folder;
}

export type Rebuilt = {
	sprites: Sprite[];
	exportErrors: Record<string, string>;
	entries: LogEntry[];
	replay?: Replay;
};

export function rebuildRun(ghospriteDir: string, outDir: string): Rebuilt {
	const newest = listRuns(ghospriteDir)[0];
	if (newest === undefined) {
		return { sprites: [], exportErrors: {}, entries: [] };
	}
	const folder = join(ghospriteDir, newest);
	const { entries } = readRun(folder);
	const session = new Session();
	const replay = replayRun(session, folder, entries);
	const exportErrors: Record<string, string> = {};
	const ids = session.workspace.spriteIds();
	for (const id of ids) {
		for (const [file, scale] of [
			[`${id}.png`, 1],
			[`${id}@8x.png`, 8],
		] as const) {
			try {
				callTool(session, "sprite.export", {
					spriteId: id,
					path: join(outDir, file),
					frame: 0,
					scale,
				});
			} catch (error) {
				exportErrors[file] =
					error instanceof Error ? error.message : String(error);
			}
		}
		try {
			callTool(session, "sprite.save", {
				spriteId: id,
				path: join(outDir, `${id}.aseprite`),
			});
		} catch (error) {
			exportErrors[`${id}.aseprite`] =
				error instanceof Error ? error.message : String(error);
		}
	}
	return {
		sprites: ids.map((id) => session.workspace.getSprite(id)),
		exportErrors,
		entries,
		...(replay.stopped ? { replay } : {}),
	};
}

function sha256(data: string | Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function git(...args: string[]): string {
	const result = Bun.spawnSync(["git", ...args], { cwd: REPO });
	return result.stdout.toString().trim();
}

async function probeServer(): Promise<{
	instructions: string | undefined;
	tools: ToolSchema[];
}> {
	const client = new Client({ name: "ghosprite-eval", version: "0.0.0" });
	await client.connect(
		new StdioClientTransport({
			command: "bun",
			args: mcpServerArgs(["--no-history"]),
		}),
	);
	try {
		const { tools } = await client.listTools();
		return {
			instructions: client.getInstructions(),
			tools: tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })),
		};
	} finally {
		await client.close();
	}
}

function parseTranscript(path: string): unknown[] {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as unknown];
			} catch {
				return [];
			}
		});
}

type Line = Record<string, unknown>;

function findLine(events: unknown[], type: string, subtype?: string) {
	const lines = events as Line[];
	const matching = lines.filter(
		(l) => l?.type === type && (subtype === undefined || l.subtype === subtype),
	);
	return matching.at(-1);
}

type Mcp = { hash: string; size: number; tools: ToolSchema[] };

async function runOnce(
	definition: EvalDefinition,
	name: string,
	prompt: string,
	model: string,
	caps: Caps,
	mcp: Mcp,
	runFolder: string,
	dirty: boolean,
	commit: string,
): Promise<string> {
	mkdirSync(runFolder, { recursive: true });
	const cwd = mkdtempSync(join(tmpdir(), "ghosprite-eval-"));
	const transcriptPath = join(runFolder, "transcript.jsonl");
	let killed = false;
	const started = Date.now();
	try {
		const child = Bun.spawn(
			["claude", ...claudeArgs(prompt, model, caps, runFolder)],
			{
				cwd,
				env: { ...process.env, ...CLAUDE_ENV },
				stdin: "ignore",
				stdout: Bun.file(transcriptPath),
				stderr: Bun.file(join(runFolder, "claude-stderr.log")),
			},
		);
		const timer = setTimeout(() => {
			killed = true;
			child.kill();
		}, caps.minutes * 60_000);
		await child.exited;
		clearTimeout(timer);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
	const wallSeconds = (Date.now() - started) / 1000;

	const events = parseTranscript(transcriptPath);
	const init = findLine(events, "system", "init");
	const result = findLine(events, "result");
	const rebuilt = rebuildRun(join(runFolder, "ghosprite"), runFolder);
	const metrics = computeMetrics(events, mcp.tools, rebuilt.entries);
	const checks = runChecks(definition, rebuilt.sprites);
	const capped = classifyCap(result?.subtype, killed);

	writeJson(join(runFolder, "metadata.json"), {
		model: init?.model ?? null,
		claude_code_version: init?.claude_code_version ?? null,
		commit,
		dirty,
		promptSha256: sha256(prompt),
		mcp: { sha256: mcp.hash, bytes: mcp.size },
		mcp_servers: init?.mcp_servers ?? null,
		skills: init?.skills ?? null,
		tools: init?.tools ?? null,
		caps,
		capped,
		resultSubtype: result?.subtype ?? null,
		wallSeconds,
		exportErrors: rebuilt.exportErrors,
		...(rebuilt.replay ? { replay: rebuilt.replay } : {}),
	});
	writeJson(join(runFolder, "metrics.json"), metrics);
	writeJson(join(runFolder, "checks.json"), checks);

	const passed = checks.checks.filter((c) => c.pass).length;
	const cost =
		metrics.costUsd === null ? "unknown" : `$${metrics.costUsd.toFixed(2)}`;
	return `${name} ${runFolder.split("/").at(-1)}: ${capped === null ? "not capped" : `capped (${capped})`}, checks ${passed}/${checks.checks.length}, cost ${cost}`;
}

function usageError(message: string): never {
	console.error(message);
	process.exit(2);
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			model: { type: "string", default: "sonnet" },
			runs: { type: "string", default: "3" },
			"max-turns": { type: "string", default: "150" },
			"max-budget-usd": { type: "string", default: "5" },
			minutes: { type: "string", default: "30" },
		},
	});
	const available = readdirSync(EVALS, { withFileTypes: true })
		.filter((e) => e.isDirectory() && e.name !== "results")
		.map((e) => e.name);
	const name = positionals[0];
	if (name === undefined || !available.includes(name)) {
		usageError(
			`Usage: bun run eval <name> [--model <m>] [--runs <n>] [--max-turns <n>] [--max-budget-usd <x>] [--minutes <n>]\nEvals: ${available.join(", ")}`,
		);
	}
	const numbers = {
		runs: Number(values.runs),
		maxTurns: Number(values["max-turns"]),
		maxBudgetUsd: Number(values["max-budget-usd"]),
		minutes: Number(values.minutes),
	};
	for (const [key, value] of Object.entries(numbers)) {
		if (!(value > 0)) usageError(`--${key} needs a positive number`);
	}
	const { runs, ...caps } = numbers;
	const model = values.model as string;

	const prompt = readFileSync(join(EVALS, name, "prompt.md"), "utf8");
	const definition = (await import(join(EVALS, name, "eval.ts")))
		.default as EvalDefinition;

	const commit = git("rev-parse", "--short", "HEAD");
	const dirty =
		git(
			"status",
			"--porcelain",
			"--",
			"src",
			"package.json",
			"bun.lock",
			`evals/${name}`,
		) !== "";
	const set = setFolder(
		join(EVALS, "results"),
		name,
		new Date().toISOString().slice(0, 10),
		model,
		commit,
	);
	mkdirSync(set, { recursive: true });

	const probe = await probeServer();
	const mcpText = `${JSON.stringify(probe, null, "\t")}\n`;
	writeFileSync(join(set, "mcp.json"), mcpText);
	const mcp: Mcp = {
		hash: sha256(mcpText),
		size: Buffer.byteLength(mcpText),
		tools: probe.tools,
	};

	for (let i = 1; i <= runs; i++) {
		console.log(
			await runOnce(
				definition,
				name,
				prompt,
				model,
				caps,
				mcp,
				join(set, String(i)),
				dirty,
				commit,
			),
		);
	}
}

if (import.meta.main) await main();
