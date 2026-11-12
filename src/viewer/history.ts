import { type Image, renderFrame } from "../core/index.ts";
import { renderPng } from "../ops/render-output.ts";
import type { LogEntry } from "../session.ts";
import type { Workspace } from "../workspace.ts";

export class StepPictures {
	private readonly pictures = new Map<string, Uint8Array>();

	record(entry: LogEntry, workspace: Workspace): void {
		if (entry.kind !== "step") return;
		try {
			const images: Image[] = entry.sprites.flatMap((id) => {
				const sprite = workspace.getSprite(id);
				return sprite.frameDurations.map((_, frame) =>
					renderFrame(sprite, frame),
				);
			});
			const { png } = renderPng(
				images,
				{ scale: 1, grid: false },
				{ columns: images.length, gap: 1 },
				"sprites",
			);
			this.pictures.set(entry.checkpointId, png);
		} catch {
			// The tool call already succeeded; a missing picture must not fail it.
		}
	}

	get(checkpointId: string): Uint8Array | undefined {
		return this.pictures.get(checkpointId);
	}
}

export function currentPath(log: LogEntry[]): Set<string> {
	let stack: string[] = [];
	let position = 0;
	for (const entry of log) {
		if (entry.kind === "step") {
			stack = stack.slice(0, position);
			stack.push(entry.checkpointId);
			position = stack.length;
		} else {
			position =
				entry.checkpointId === "checkpoint-0"
					? 0
					: stack.indexOf(entry.checkpointId) + 1;
		}
	}
	return new Set(stack.slice(0, position));
}
