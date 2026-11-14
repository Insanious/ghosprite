import { describe, expect, test } from "bun:test";
import type { GalleryTag } from "./gallery-run.ts";
import { frameOrder, playRange, resumeIndex } from "./playback.ts";

const tags: GalleryTag[] = [
	{ name: "a", from: 1, to: 3, direction: "reverse" },
	{ name: "a", from: 2, to: 4, direction: "forward" },
];
const durations = [100, 100, 100, 100, 100];

describe("frameOrder", () => {
	test("orders one cycle per direction", () => {
		expect(frameOrder(1, 4, "forward")).toEqual([1, 2, 3, 4]);
		expect(frameOrder(1, 4, "reverse")).toEqual([4, 3, 2, 1]);
		expect(frameOrder(1, 4, "ping-pong")).toEqual([1, 2, 3, 4, 3, 2]);
		expect(frameOrder(1, 4, "ping-pong-reverse")).toEqual([4, 3, 2, 1, 2, 3]);
	});

	test("handles one and two frames", () => {
		for (const d of [
			"forward",
			"reverse",
			"ping-pong",
			"ping-pong-reverse",
		] as const) {
			expect(frameOrder(2, 2, d)).toEqual([2]);
		}
		expect(frameOrder(1, 2, "ping-pong")).toEqual([1, 2]);
		expect(frameOrder(1, 2, "ping-pong-reverse")).toEqual([2, 1]);
	});
});

describe("playRange", () => {
	test("covers all frames without a matching tag", () => {
		const all = { from: 0, to: 4, direction: "forward" as const };
		expect(playRange(durations, tags, null)).toEqual(all);
		expect(playRange(durations, tags, "missing")).toEqual(all);
	});

	test("uses the first tag of that name", () => {
		expect(playRange(durations, tags, "a")).toEqual({
			from: 1,
			to: 3,
			direction: "reverse",
		});
	});
});

describe("resumeIndex", () => {
	test("finds the first occurrence or falls back to 0", () => {
		expect(resumeIndex([1, 2, 3, 4, 3, 2], 3)).toBe(2);
		expect(resumeIndex([1, 2, 3, 4, 3, 2], 0)).toBe(0);
	});
});

describe("embedding by source text", () => {
	test("each function works when rebuilt from toString()", () => {
		const rebuilt = <T>(fn: T): T => new Function(`return ${String(fn)}`)();
		expect(rebuilt(playRange)(durations, tags, "a")).toEqual(
			playRange(durations, tags, "a"),
		);
		expect(rebuilt(playRange)(durations, tags, null)).toEqual(
			playRange(durations, tags, null),
		);
		for (const d of [
			"forward",
			"reverse",
			"ping-pong",
			"ping-pong-reverse",
		] as const) {
			expect(rebuilt(frameOrder)(1, 4, d)).toEqual(frameOrder(1, 4, d));
			expect(rebuilt(frameOrder)(2, 2, d)).toEqual(frameOrder(2, 2, d));
		}
		expect(rebuilt(resumeIndex)([1, 2, 3, 4, 3, 2], 3)).toBe(2);
		expect(rebuilt(resumeIndex)([1, 2, 3, 4, 3, 2], 0)).toBe(0);
	});
});
