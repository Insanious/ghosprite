import type { ImageLayer, Sprite } from "./core/index.ts";
import { OpError } from "./errors.ts";
import type { Workspace } from "./workspace.ts";

export function requireRgba(sprite: Sprite): void {
	if (sprite.mode !== "rgba") {
		throw new OpError("unsupported", `Cannot edit a ${sprite.mode} sprite`, {
			hint: "Only RGBA sprites are supported",
		});
	}
}

export function checkFrame(
	sprite: Sprite,
	frame: number,
	path = "frame",
): void {
	if (frame >= sprite.frameDurations.length) {
		throw new OpError(
			"out_of_range",
			`Frame ${frame} is outside 0..${sprite.frameDurations.length - 1}`,
			{ path },
		);
	}
}

export function checkFrames(
	sprite: Sprite,
	frames: number[],
	path = "frames",
): void {
	frames.forEach((frame, index) => {
		checkFrame(sprite, frame, `${path}.${index}`);
	});
}

export function checkPoint(
	sprite: Sprite,
	point: { x: number; y: number },
	path: string,
): void {
	if (
		point.x < 0 ||
		point.y < 0 ||
		point.x >= sprite.width ||
		point.y >= sprite.height
	) {
		throw new OpError(
			"out_of_range",
			`Point (${point.x}, ${point.y}) is outside the ${sprite.width}x${sprite.height} canvas`,
			{ path },
		);
	}
}

export function getImageLayer(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	path = "layerId",
): ImageLayer {
	const layer = workspace.getLayer(spriteId, layerId, path);
	if (layer.kind !== "image") {
		throw new OpError("invalid_input", `Layer "${layer.id}" is a group`, {
			path,
			hint: "Target an image layer",
		});
	}
	return layer;
}

/** The image layer and sprite an edit targets, rejecting groups, missing frames and non-RGBA sprites. */
export function resolveTarget(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	frame: number,
	prefix = "",
): { sprite: Sprite; layer: ImageLayer } {
	const sprite = workspace.getSprite(spriteId);
	const layer = getImageLayer(workspace, spriteId, layerId, `${prefix}layerId`);
	checkFrame(sprite, frame, `${prefix}frame`);
	requireRgba(sprite);
	return { sprite, layer };
}

export function resolveTargetFrames(
	workspace: Workspace,
	spriteId: string,
	layerId: string,
	frames: number[],
): { sprite: Sprite; layer: ImageLayer } {
	const sprite = workspace.getSprite(spriteId);
	const layer = getImageLayer(workspace, spriteId, layerId);
	checkFrames(sprite, frames);
	requireRgba(sprite);
	return { sprite, layer };
}
