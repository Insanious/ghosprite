import type { UserData } from "./user-data.ts";

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

/**
 * Aseprite keeps tags ordered by from, then longest first, and a tag equal to
 * an existing one goes after it.
 */
export function insertTag(sprite: { tags: Tag[] }, tag: Tag): void {
	const { tags } = sprite;
	const before = tags.findIndex(
		(other) =>
			other.from > tag.from || (other.from === tag.from && other.to < tag.to),
	);
	tags.splice(before < 0 ? tags.length : before, 0, tag);
}

export function removeTag(sprite: { tags: Tag[] }, index: number): void {
	sprite.tags.splice(index, 1);
}
