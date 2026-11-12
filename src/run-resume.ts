import { basename, resolve } from "node:path";
import { z } from "zod";
import { OpError } from "./errors.ts";
import type { RunLog } from "./run-log.ts";
import { readRun, replayRun, versionWarning } from "./run-replay.ts";
import { type LogEntry, Session } from "./session.ts";
import { defineTool, type Tool } from "./tools.ts";

function replayOrThrow(
	session: Session,
	folder: string,
	entries: LogEntry[],
	step: number,
): void {
	const { stopped } = replayRun(session, folder, entries);
	if (stopped) {
		throw new OpError(
			"invalid_input",
			`Cannot resume step ${step}: the replay stopped at ${stopped.checkpointId}: ${stopped.message}`,
			{ path: "run" },
		);
	}
}

export function resumeTool(history?: { dir: string; log: RunLog }): Tool {
	return defineTool({
		name: "session.resume",
		description:
			"Rebuild a run saved with --history up to one of its steps, with the same sprite, layer and checkpoint ids, then carry on from there. `run` is a folder name inside the history directory, or a path; `step` is the step number, the N of checkpoint-N. Only works before any change has been made in this session.",
		schema: z.object({
			run: z.string(),
			step: z.number().int().min(1),
		}),
		run: (session, input) => {
			if (session.stepLog().length > 0) {
				throw new OpError(
					"unsupported",
					"Resuming needs a session with no steps yet",
				);
			}
			const folder =
				history !== undefined && basename(input.run) === input.run
					? resolve(history.dir, input.run)
					: resolve(input.run);
			let run: ReturnType<typeof readRun>;
			try {
				run = readRun(folder);
			} catch (error) {
				throw new OpError(
					"not_found",
					error instanceof Error ? error.message : String(error),
					{ path: "run" },
				);
			}
			const checkpointId = `checkpoint-${input.step}`;
			const last = run.entries.findIndex(
				(entry) => entry.kind === "step" && entry.checkpointId === checkpointId,
			);
			if (last < 0) {
				throw new OpError("not_found", `${folder} has no step ${input.step}`, {
					path: "step",
				});
			}
			const entries = run.entries.slice(0, last + 1);
			replayOrThrow(new Session(), folder, entries, input.step);
			const replay = () => replayOrThrow(session, folder, entries, input.step);
			if (history === undefined) replay();
			else history.log.resume(folder, input.step, entries, replay);
			return {
				checkpointId,
				sprites: session.workspace.spriteIds(),
				run: history?.log.name,
				warning: versionWarning(run.version),
			};
		},
	});
}
