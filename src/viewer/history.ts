import { type Image, renderFrame, type Sprite } from "../core/index.ts";
import { renderPng } from "../ops/render-output.ts";
import type { LogEntry } from "../session.ts";
import type { Workspace } from "../workspace.ts";

export function renderSprites(sprites: Sprite[]): Uint8Array {
	const images: Image[] = sprites.flatMap((sprite) =>
		sprite.frameDurations.map((_, frame) => renderFrame(sprite, frame)),
	);
	return renderPng(
		images,
		{ scale: 1, grid: false },
		{ columns: images.length, gap: 1 },
		"sprites",
	).png;
}

export class StepPictures {
	private readonly pictures = new Map<string, Uint8Array>();

	record(entry: LogEntry, workspace: Workspace): void {
		if (entry.kind !== "step") return;
		try {
			this.pictures.set(
				entry.checkpointId,
				renderSprites(entry.sprites.map((id) => workspace.getSprite(id))),
			);
		} catch {
			// The tool call already succeeded; a missing picture must not fail it.
		}
	}

	get(checkpointId: string): Uint8Array | undefined {
		return this.pictures.get(checkpointId);
	}
}

function walk(log: LogEntry[]): { stack: string[]; position: number } {
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
	return { stack, position };
}

export function currentPath(log: LogEntry[]): Set<string> {
	const { stack, position } = walk(log);
	return new Set(stack.slice(0, position));
}

export function currentCheckpoint(log: LogEntry[]): string | undefined {
	const { stack, position } = walk(log);
	return stack[position - 1];
}
