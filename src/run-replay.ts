import { readFileSync } from "node:fs";
import { join } from "node:path";
import { version } from "../package.json";
import { mapLoadCalls } from "./run-log.ts";
import type { LogEntry, Session } from "./session.ts";
import { callTool } from "./tools.ts";

export type Run = {
	version: string;
	resumedFrom?: { run: string; step: number };
	entries: LogEntry[];
};

export function versionWarning(runVersion: string): string | undefined {
	if (runVersion === version) return undefined;
	return `This run was saved by ghosprite ${runVersion}; this is ghosprite ${version}. Some steps may be drawn differently.`;
}

export type Replay = { stopped?: { checkpointId: string; message: string } };

function parseLine(folder: string, text: string, number: number): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${folder}: line ${number} of log.jsonl is not valid JSON`);
	}
}

export function readRun(folder: string): Run {
	let text: string;
	try {
		text = readFileSync(join(folder, "log.jsonl"), "utf8");
	} catch {
		throw new Error(`${folder}: cannot read log.jsonl`);
	}
	const lines = text.split("\n").slice(0, -1);
	const first =
		lines.length > 0 ? parseLine(folder, lines[0] as string, 1) : null;
	const header = first as { kind?: unknown; version?: unknown } | null;
	if (
		typeof header !== "object" ||
		header === null ||
		header.kind !== "run" ||
		typeof header.version !== "string"
	) {
		throw new Error(`${folder}: line 1 of log.jsonl is not a run line`);
	}
	const parsed = lines
		.slice(1)
		.map((line, index) => parseLine(folder, line, index + 2));
	const second = parsed[0] as { kind?: unknown; run?: unknown; step?: unknown };
	let resumedFrom: Run["resumedFrom"];
	let entries = parsed;
	if (second?.kind === "resumed") {
		if (typeof second.run !== "string" || typeof second.step !== "number") {
			throw new Error(`${folder}: line 2 of log.jsonl is not a resumed line`);
		}
		resumedFrom = { run: second.run, step: second.step };
		entries = parsed.slice(1);
	}
	for (const [index, entry] of entries.entries()) {
		if ((entry as { kind?: unknown } | null)?.kind === "resumed") {
			const number = index + 2 + (resumedFrom ? 1 : 0);
			throw new Error(
				`${folder}: line ${number} of log.jsonl is a misplaced resumed line`,
			);
		}
	}
	return {
		version: header.version,
		...(resumedFrom && { resumedFrom }),
		entries: entries as LogEntry[],
	};
}

function producedCheckpoint(result: unknown): string | undefined {
	return (result as { checkpointId?: string } | undefined)?.checkpointId;
}

export function replayRun(
	session: Session,
	folder: string,
	entries: LogEntry[],
): Replay {
	for (const entry of entries) {
		try {
			if (entry.kind === "moved") {
				session.restore(entry.checkpointId);
				continue;
			}
			const input = mapLoadCalls(entry.op, entry.input, (call) => ({
				...call,
				input: { ...call.input, path: join(folder, call.input.path) },
			}));
			const produced = producedCheckpoint(callTool(session, entry.op, input));
			if (produced !== entry.checkpointId) {
				return {
					stopped: {
						checkpointId: entry.checkpointId,
						message: `replayed as ${produced}, expected ${entry.checkpointId}`,
					},
				};
			}
		} catch (error) {
			return {
				stopped: {
					checkpointId: entry.checkpointId,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}
	return {};
}
