#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { serveStdio } from "./mcp.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";

const USAGE = `Usage:
  ghosprite run [file] [--out <dir>]   run a JSON array of {op, input} calls (stdin if no file or "-")
  ghosprite ops                        print every operation and its input schema as JSON
  ghosprite mcp [--viewer [port]]      serve every operation and session tool over MCP on stdio;
                                       --viewer also serves a read-only step timeline on localhost (default port 7357)`;

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

function parseViewerPort(args: string[]): number | undefined {
	if (args.length === 0) return undefined;
	if (args[0] !== "--viewer" || args.length > 2) {
		return usageError("ghosprite mcp takes only --viewer [port]");
	}
	if (args.length === 1) return DEFAULT_VIEWER_PORT;
	const port = Number(args[1]);
	if (!/^\d+$/.test(args[1] as string) || port < 1 || port > 65535) {
		return usageError("The viewer port must be an integer from 1 to 65535");
	}
	return port;
}

const [command, ...rest] = process.argv.slice(2);
if (command === "run") {
	await run(rest);
} else if (command === "ops" && rest.length === 0) {
	console.log(JSON.stringify(describeTools(new Session()), null, 2));
} else if (command === "mcp") {
	await serveStdio(parseViewerPort(rest));
} else {
	usageError(command ? `Unknown command "${command}"` : "Missing command");
}
