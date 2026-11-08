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
  ghosprite mcp                        serve every operation and session tool over MCP on stdio`;

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

const [command, ...rest] = process.argv.slice(2);
if (command === "run") {
	await run(rest);
} else if (command === "ops" && rest.length === 0) {
	console.log(JSON.stringify(describeTools(new Session()), null, 2));
} else if (command === "mcp" && rest.length === 0) {
	await serveStdio();
} else {
	usageError(command ? `Unknown command "${command}"` : "Missing command");
}
