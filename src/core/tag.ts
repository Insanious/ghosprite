import { recordTags } from "./history.ts";
import type { Sprite } from "./sprite.ts";
import { cloneUserData, type UserData } from "./user-data.ts";

/** Indexed by the direction byte of the file's tags chunk. */
export const TAG_DIRECTIONS = [
	"forward",
	"reverse",
	"ping-pong",
	"ping-pong-reverse",
] as const;

export type TagDirection = (typeof TAG_DIRECTIONS)[number];

export type Tag = {
	name: string;
	from: number;
	to: number;
	direction: TagDirection;
	repeat: number;
	userData: UserData;
};

export function cloneTag(tag: Tag): Tag {
	return { ...tag, userData: cloneUserData(tag.userData) };
}

/**
 * Aseprite keeps tags ordered by from, then longest first, and a tag equal to
 * an existing one goes after it.
 */
export function insertTag(sprite: Sprite, tag: Tag): void {
	recordTags(sprite);
	const { tags } = sprite;
	const before = tags.findIndex(
		(other) =>
			other.from > tag.from || (other.from === tag.from && other.to < tag.to),
	);
	tags.splice(before < 0 ? tags.length : before, 0, tag);
}

export function removeTag(sprite: Sprite, index: number): void {
	recordTags(sprite);
	sprite.tags.splice(index, 1);
}
