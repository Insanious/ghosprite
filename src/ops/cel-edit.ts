import {
	type CelCanvas,
	type CelCommit,
	celCanvas,
	commitCel,
} from "../core/cel-edit.ts";
import { isEmptyRect, type Rect, unionRects } from "../core/image.ts";
import {
	type CelDataId,
	celCanvasRect,
	type ImageLayer,
	type Sprite,
	setCelOpacity,
} from "../core/sprite.ts";
import type { ChangedRect } from "./registry.ts";

/** Receives the cel's pixels and returns the canvas to commit, edited in place or a different one. */
export type CelEdit = (canvas: CelCanvas, frame: number) => CelCanvas;

type Target = { sprite: Sprite; layer: ImageLayer };

function commitEdit(
	{ sprite, layer }: Target,
	frame: number,
	edit: CelEdit,
): CelCommit {
	const canvas = edit(celCanvas(sprite, layer, frame), frame);
	return commitCel(sprite, layer, frame, canvas);
}

function changedRects(
	layer: ImageLayer,
	frames: number[],
	rect: Rect,
): ChangedRect[] {
	if (isEmptyRect(rect)) return [];
	return frames.map((frame) => ({ layerId: layer.id, frame, rect }));
}

/** Edits the cel of each distinct frame in ascending order, once per cel shared between frames. */
export function editCels(
	target: Target,
	frames: number[],
	edit: CelEdit,
): { changed: ChangedRect[] } {
	const edited = new Set<CelDataId>();
	const changed: ChangedRect[] = [];
	for (const frame of [...new Set(frames)].sort((a, b) => a - b)) {
		const cel = target.layer.cels.get(frame);
		if (!cel || edited.has(cel.data.id)) continue;
		edited.add(cel.data.id);
		const commit = commitEdit(target, frame, edit);
		changed.push(...changedRects(target.layer, commit.frames, commit.rect));
	}
	return { changed };
}

/**
 * Edits one frame's cel, creating it from a transparent canvas when the frame has none.
 * `cel` is the committed cel's bounds, null when no cel is left. A given `opacity` that
 * differs from the cel's is applied and counts the whole cel as changed.
 */
export function editCel(
	target: Target,
	frame: number,
	edit: CelEdit,
	opacity?: number,
): { changed: ChangedRect[]; cel: Rect | null } {
	const commit = commitEdit(target, frame, edit);
	let rect = commit.rect;
	const cel = target.layer.cels.get(frame);
	if (opacity !== undefined && cel && cel.data.opacity !== opacity) {
		setCelOpacity(target.sprite, target.layer, frame, opacity);
		rect = unionRects(rect, celCanvasRect(target.sprite, cel.data));
	}
	return {
		changed: changedRects(target.layer, commit.frames, rect),
		cel: commit.cel ?? null,
	};
}
