#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { historyDir, latestRun } from "./history-dir.ts";
import { serveStdio } from "./mcp.ts";
import { type Run, readRun, replayRun, versionWarning } from "./run-replay.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";
import { StepPictures } from "./viewer/history.ts";
import { startViewer } from "./viewer/server.ts";

const USAGE = `Usage:
  ghosprite run [file] [--out <dir>]   run a JSON array of {op, input} calls (stdin if no file or "-")
  ghosprite ops                        print every operation and its input schema as JSON
  ghosprite mcp [--viewer [port] | --no-viewer] [--history <dir> | --no-history]
                                       serve every operation and session tool over MCP on stdio;
                                       the viewer, a read-only step timeline on localhost (default port 7357), is on by default;
                                       history, which writes the run's step log and loaded files to a new folder, is on by default;
                                       the history folder is --history <dir>, else $GHOSPRITE_HISTORY, else
                                       $XDG_STATE_HOME/ghosprite/runs (~/.local/state/ghosprite/runs) on Linux,
                                       ~/Library/Application Support/ghosprite/runs on macOS,
                                       %LOCALAPPDATA%\\ghosprite\\runs on Windows
  ghosprite view [run folder] [--port <n>]
                                       replay a run saved by ghosprite mcp and serve its read-only step timeline
                                       on localhost (default port 7357); with no run folder, opens the latest run
                                       in the history folder ($GHOSPRITE_HISTORY, else the platform default above)`;

function usageError(message: string): never {
	process.stderr.write(`${message}\n${USAGE}\n`);
	process.exit(2);
}

type Call = { op: string; input: unknown };

function parseCalls(text: string): Call[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return usageError(`Script is not valid JSON: ${(error as Error).message}`);
	}
	const isCall = (c: unknown): c is Call =>
		typeof c === "object" && c !== null && typeof (c as Call).op === "string";
	if (!Array.isArray(parsed) || !parsed.every(isCall)) {
		return usageError('Script must be a JSON array of { "op", "input" } calls');
	}
	return parsed;
}

async function readScript(file: string | undefined): Promise<string> {
	if (file === undefined || file === "-") return Bun.stdin.text();
	try {
		return await Bun.file(file).text();
	} catch {
		return usageError(`Cannot read ${file}`);
	}
}

async function run(args: string[]) {
	let values: { out?: string };
	let positionals: string[];
	try {
		({ values, positionals } = parseArgs({
			args,
			options: { out: { type: "string" } },
			allowPositionals: true,
		}));
	} catch (error) {
		return usageError((error as Error).message);
	}
	if (positionals.length > 1) return usageError("Too many arguments");

	const calls = parseCalls(await readScript(positionals[0]));
	const outDir = values.out ?? mkdtempSync(join(tmpdir(), "ghosprite-"));
	mkdirSync(outDir, { recursive: true });

	const session = new Session();
	for (const [index, call] of calls.entries()) {
		try {
			const result = replaceImages(
				callTool(session, call.op, call.input),
				(png, path) => {
					const file = join(outDir, `${[index, ...path].join("-")}.png`);
					writeFileSync(file, png);
					return { key: "path", value: file };
				},
			);
			console.log(JSON.stringify({ op: call.op, result }));
		} catch (error) {
			console.log(JSON.stringify({ op: call.op, error }));
			process.exit(1);
		}
	}
}

const DEFAULT_VIEWER_PORT = 7357;

function parsePort(value: string): number {
	const port = Number(value);
	if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
		return usageError("The viewer port must be an integer from 1 to 65535");
	}
	return port;
}

function latestRunFolder(): string {
	const dir = historyDir(undefined, process.env, process.platform, homedir());
	let latest: string | undefined;
	try {
		latest = latestRun(dir);
	} catch (error) {
		process.stderr.write(`${(error as Error).message}\n`);
		process.exit(1);
	}
	return latest ?? usageError(`No runs in ${dir}`);
}

async function view(args: string[]) {
	let values: { port?: string };
	let positionals: string[];
	try {
		({ values, positionals } = parseArgs({
			args,
			options: { port: { type: "string" } },
			allowPositionals: true,
		}));
	} catch (error) {
		return usageError((error as Error).message);
	}
	if (positionals.length > 1) {
		return usageError("ghosprite view takes at most one run folder");
	}
	const port =
		values.port === undefined ? DEFAULT_VIEWER_PORT : parsePort(values.port);
	const [folderArg] = positionals;
	const folder = resolve(folderArg ?? latestRunFolder());

	let run: Run;
	try {
		run = readRun(folder);
	} catch (error) {
		process.stderr.write(`${(error as Error).message}\n`);
		process.exit(1);
	}

	const pictures = new StepPictures();
	const session = new Session({
		onLog: (entry, workspace) => pictures.record(entry, workspace),
	});
	const { stopped } = replayRun(session, folder, run.entries);

	const warnings: string[] = [];
	const versionNote = versionWarning(run.version);
	if (versionNote !== undefined) warnings.push(versionNote);
	if (stopped !== undefined) {
		const step = stopped.checkpointId.replace(/^checkpoint-/, "");
		const warning = `Replay stopped at step ${step}: ${stopped.message}`;
		warnings.push(warning);
		process.stderr.write(`${warning}\n`);
	}
	const viewer = startViewer(session, pictures, port, {
		runName: basename(folder),
		warnings,
	});
	console.log(viewer.url);
}

const MCP_FLAGS = ["--viewer", "--no-viewer", "--history", "--no-history"];

function parseMcpArgs(args: string[]): {
	viewerPort?: number;
	historyDir?: string;
} {
	const seen = new Set<string>();
	let viewerPort: number | undefined;
	let historyFlag: string | undefined;
	const isValue = (arg: string | undefined): arg is string =>
		arg !== undefined && !arg.startsWith("--");
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined || !MCP_FLAGS.includes(arg) || seen.has(arg)) {
			return usageError(
				"ghosprite mcp takes only --viewer [port], --no-viewer, --history <dir> and --no-history, each once",
			);
		}
		seen.add(arg);
		if (arg === "--viewer") {
			const value = args[i + 1];
			if (isValue(value)) {
				i++;
				viewerPort = parsePort(value);
			}
		} else if (arg === "--history") {
			const value = args[i + 1];
			if (!isValue(value)) return usageError("--history needs a directory");
			i++;
			historyFlag = value;
		}
	}
	if (seen.has("--viewer") && seen.has("--no-viewer")) {
		return usageError("--viewer and --no-viewer can't be used together");
	}
	if (seen.has("--history") && seen.has("--no-history")) {
		return usageError("--history and --no-history can't be used together");
	}
	return {
		viewerPort: seen.has("--no-viewer")
			? undefined
			: (viewerPort ?? DEFAULT_VIEWER_PORT),
		historyDir: seen.has("--no-history")
			? undefined
			: historyDir(historyFlag, process.env, process.platform, homedir()),
	};
}

const [command, ...rest] = process.argv.slice(2);
if (command === "run") {
	await run(rest);
} else if (command === "ops" && rest.length === 0) {
	console.log(JSON.stringify(describeTools(new Session()), null, 2));
} else if (command === "mcp") {
	await serveStdio(parseMcpArgs(rest));
} else if (command === "view") {
	await view(rest);
} else {
	usageError(command ? `Unknown command "${command}"` : "Missing command");
}
