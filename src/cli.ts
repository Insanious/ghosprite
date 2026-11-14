#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { historyDir } from "./history-dir.ts";
import { serveStdio } from "./mcp.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";
import { startGallery } from "./viewer/gallery.ts";

const USAGE = `Usage:
  ghosprite run [file] [--out <dir>]   run a JSON array of {op, input} calls (stdin if no file or "-")
  ghosprite ops                        print every operation and its input schema as JSON
  ghosprite mcp [--viewer [port] | --no-viewer] [--history <dir> | --no-history]
                                       serve every operation and session tool over MCP on stdio;
                                       it serves no page: results of sprite_create and sprite_load carry a link to the
                                       ghosprite view gallery, on by default, on port 7357 unless --viewer <port> says
                                       otherwise, and needing history (--no-viewer or --no-history turns links off);
                                       history, which writes the run's step log and loaded files to a new folder, is on by default;
                                       the history folder is --history <dir>, else $GHOSPRITE_HISTORY, else
                                       $XDG_STATE_HOME/ghosprite/runs (~/.local/state/ghosprite/runs) on Linux,
                                       ~/Library/Application Support/ghosprite/runs on macOS,
                                       %LOCALAPPDATA%\\ghosprite\\runs on Windows
  ghosprite view [--port <n>]
                                       serve a read-only gallery of every run saved by ghosprite mcp on localhost
                                       (default port 7357, no fallback port), from the history folder
                                       ($GHOSPRITE_HISTORY, else the platform default above)`;

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

function view(args: string[]) {
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
	if (positionals.length > 0) {
		return usageError("ghosprite view takes only --port <n>");
	}
	const port =
		values.port === undefined ? DEFAULT_VIEWER_PORT : parsePort(values.port);
	const dir = historyDir(undefined, process.env, process.platform, homedir());
	try {
		console.log(startGallery(dir, port).url);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
			return usageError(`Port ${port} is already in use`);
		}
		throw error;
	}
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
	if (seen.has("--viewer") && seen.has("--no-history")) {
		return usageError(
			"--viewer needs history: --no-history turns the viewer links off",
		);
	}
	return {
		viewerPort:
			seen.has("--no-viewer") || seen.has("--no-history")
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
