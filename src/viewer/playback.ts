import type { GalleryTag } from "./gallery-run.ts";

export function playRange(
	durations: number[],
	tags: GalleryTag[],
	tagName: string | null,
): { from: number; to: number; direction: GalleryTag["direction"] } {
	const tag =
		tagName === null ? undefined : tags.find((t) => t.name === tagName);
	if (!tag) return { from: 0, to: durations.length - 1, direction: "forward" };
	return { from: tag.from, to: tag.to, direction: tag.direction };
}

export function frameOrder(
	from: number,
	to: number,
	direction: GalleryTag["direction"],
): number[] {
	const up: number[] = [];
	for (let f = from; f <= to; f++) up.push(f);
	const down = [...up].reverse();
	if (direction === "forward") return up;
	if (direction === "reverse") return down;
	if (direction === "ping-pong") return up.concat(down.slice(1, -1));
	return down.concat(up.slice(1, -1));
}

export function resumeIndex(order: number[], currentFrame: number): number {
	return Math.max(0, order.indexOf(currentFrame));
}
