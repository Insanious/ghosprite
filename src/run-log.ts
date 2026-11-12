import { createHash } from "node:crypto";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { version } from "../package.json";
import type { LogEntry } from "./session.ts";

export type RunLog = {
	name: string;
	folder: string;
	append(entry: LogEntry): void;
};

type LoadCall = {
	op: string;
	input: { path: string } & Record<string, unknown>;
};

const LOAD_OPS = new Set(["sprite.load", "palette.load"]);

function isLoadCall(call: unknown): call is LoadCall {
	if (typeof call !== "object" || call === null) return false;
	const { op, input } = call as { op?: unknown; input?: unknown };
	return (
		typeof op === "string" &&
		LOAD_OPS.has(op) &&
		typeof input === "object" &&
		input !== null &&
		typeof (input as { path?: unknown }).path === "string"
	);
}

function createRunFolder(dir: string, now: Date): string {
	mkdirSync(dir, { recursive: true });
	const base = now.toISOString().slice(0, 19).replaceAll(":", "-");
	for (let n = 1; ; n++) {
		const folder = join(dir, n === 1 ? base : `${base}-${n}`);
		try {
			mkdirSync(folder);
			return folder;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}

function reportFailure(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`ghosprite: history: ${message}\n`);
}

export function startRunLog(dir: string, now = new Date()): RunLog {
	const folder = createRunFolder(dir, now);
	const logPath = join(folder, "log.jsonl");
	writeFileSync(
		logPath,
		`${JSON.stringify({ kind: "run", version, started: now.toISOString() })}\n`,
	);

	function storeFile(original: string): string {
		const bytes = readFileSync(original);
		const hash = createHash("sha256").update(bytes).digest("hex");
		const relative = `files/${hash}${extname(original)}`;
		const target = join(folder, relative);
		if (!existsSync(target)) {
			mkdirSync(join(folder, "files"), { recursive: true });
			writeFileSync(target, bytes);
		}
		return relative;
	}

	function rewriteLoad(
		call: LoadCall,
		loadedFrom: Record<string, string>,
	): LoadCall {
		try {
			const relative = storeFile(call.input.path);
			loadedFrom[relative] = resolve(call.input.path);
			return { ...call, input: { ...call.input, path: relative } };
		} catch (error) {
			reportFailure(error);
			return call;
		}
	}

	function rewrite(entry: LogEntry): object {
		if (entry.kind !== "step") return entry;
		const loadedFrom: Record<string, string> = {};
		let input = entry.input;
		if (isLoadCall(entry)) {
			input = rewriteLoad(entry, loadedFrom).input;
		} else if (entry.op === "session.apply") {
			const ops = (entry.input as { ops?: unknown }).ops;
			if (Array.isArray(ops)) {
				input = {
					...(entry.input as object),
					ops: ops.map((call) =>
						isLoadCall(call) ? rewriteLoad(call, loadedFrom) : call,
					),
				};
			}
		}
		if (Object.keys(loadedFrom).length === 0) return entry;
		return { ...entry, input, loadedFrom };
	}

	return {
		name: basename(folder),
		folder,
		append(entry) {
			try {
				appendFileSync(logPath, `${JSON.stringify(rewrite(entry))}\n`);
			} catch (error) {
				reportFailure(error);
			}
		},
	};
}
