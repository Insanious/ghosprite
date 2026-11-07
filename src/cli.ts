#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { OpError } from "./errors.ts";
import { operations } from "./ops/index.ts";
import { createRegistry } from "./ops/registry.ts";
import { Workspace } from "./workspace.ts";

const USAGE = `Usage:
  ghosprite run [file] [--out <dir>]   run a JSON array of {op, input} calls (stdin if no file or "-")
  ghosprite ops                        print every operation and its input schema as JSON`;

const registry = createRegistry(operations);

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

	const workspace = new Workspace();
	for (const [index, call] of calls.entries()) {
		try {
			const { render, ...rest } = registry.callOp(
				workspace,
				call.op,
				call.input,
			);
			const spriteId =
				(call.input as { spriteId?: unknown } | null)?.spriteId ??
				(rest as { spriteId?: unknown }).spriteId;
			const result: Record<string, unknown> = { ...rest };
			if (render) {
				result.render = render.map(({ frame, png }) => {
					const path = join(outDir, `${index}-${spriteId}-f${frame}.png`);
					writeFileSync(path, png);
					return { frame, path };
				});
			}
			console.log(JSON.stringify({ op: call.op, result }));
		} catch (error) {
			if (!(error instanceof OpError)) throw error;
			console.log(JSON.stringify({ op: call.op, error }));
			process.exit(1);
		}
	}
}

const [command, ...rest] = process.argv.slice(2);
if (command === "run") {
	await run(rest);
} else if (command === "ops" && rest.length === 0) {
	console.log(JSON.stringify(registry.describeOps(), null, 2));
} else {
	usageError(command ? `Unknown command "${command}"` : "Missing command");
}
