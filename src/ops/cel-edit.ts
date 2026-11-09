import { type CelCanvas, celCanvas, commitCel } from "../core/cel-edit.ts";
import { isEmptyRect } from "../core/image.ts";
import type { CelData, ImageLayer, Sprite } from "../core/sprite.ts";
import type { ChangedRect } from "./registry.ts";

/** Receives the cel's pixels and returns the canvas to commit, edited in place or a different one. */
export type CelEdit = (canvas: CelCanvas, frame: number) => CelCanvas;

type Target = { sprite: Sprite; layer: ImageLayer };

function editFrame(
	{ sprite, layer }: Target,
	frame: number,
	edit: CelEdit,
): ChangedRect[] {
	const canvas = edit(celCanvas(sprite, layer, frame), frame);
	const commit = commitCel(sprite, layer, frame, canvas);
	if (isEmptyRect(commit.rect)) return [];
	return commit.frames.map((shared) => ({
		layerId: layer.id,
		frame: shared,
		rect: commit.rect,
	}));
}

/** Edits the cel of each distinct frame in ascending order, once per cel shared between frames. */
export function editCels(
	target: Target,
	frames: number[],
	edit: CelEdit,
): { changed: ChangedRect[] } {
	const edited = new Set<CelData>();
	const changed: ChangedRect[] = [];
	for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
		const cel = target.layer.cels.get(frame);
		if (!cel || edited.has(cel.data)) continue;
		edited.add(cel.data);
		changed.push(...editFrame(target, frame, edit));
	}
	return { changed };
}
