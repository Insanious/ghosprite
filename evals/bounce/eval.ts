import { type Image, renderFrame, type Sprite } from "../../src/core/index.ts";
import {
	alphaBounds,
	alphaCentroid,
	alphaCounts,
	type Check,
	type CheckResult,
	type EvalDefinition,
	onSpriteOfSize,
} from "../../src/eval/checks.ts";

const WIDTH = 16;
const HEIGHT = 32;
const FRAMES = 6;
const BOTTOM_FRAME = 3;
const MAX_SIZE_CHANGE = 0.3;

function onSixFrames(
	run: (sprite: Sprite, frames: Image[]) => CheckResult,
): (sprites: Sprite[]) => CheckResult {
	return onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const count = sprite.frameDurations.length;
		const needs = `needs ${FRAMES} frames, each with an opaque pixel`;
		if (count !== FRAMES) {
			return {
				pass: false,
				detail: `the sprite has ${count} frames, ${needs}`,
			};
		}
		const frames = Array.from({ length: count }, (_, frame) =>
			renderFrame(sprite, frame),
		);
		const empty = frames.findIndex((frame) => alphaCounts(frame).opaque === 0);
		if (empty >= 0) {
			return {
				pass: false,
				detail: `the sprite has ${count} frames but frame ${empty} has no opaque pixel, ${needs}`,
			};
		}
		return run(sprite, frames);
	});
}

function centroidY(frame: Image): number {
	const centre = alphaCentroid(frame);
	if (!centre) throw new Error("a frame with an opaque pixel has no centroid");
	return centre.y;
}

const sixFrames: Check = {
	name: "six frames",
	part: "key poses",
	run: onSixFrames(() => ({
		pass: true,
		detail: `${FRAMES} frames, each with an opaque pixel`,
	})),
};

const squash: Check = {
	name: "squash",
	part: "key poses",
	run: onSixFrames((_, frames) => {
		const bounds = alphaBounds(frames[BOTTOM_FRAME] as Image);
		if (!bounds) throw new Error("a frame with an opaque pixel has no bounds");
		const topY = centroidY(frames[0] as Image);
		const limit = HEIGHT / 3;
		const detail = `frame 3 is ${bounds.width}x${bounds.height} ending at row ${bounds.y + bounds.height}, needs wider than tall and ending at row ${HEIGHT}; frame 0's centroid is at y ${topY.toFixed(2)}, needs below ${limit.toFixed(2)}`;
		return {
			pass:
				bounds.width > bounds.height &&
				bounds.y + bounds.height === HEIGHT &&
				topY < limit,
			detail,
		};
	}),
};

const fallsAndRises: Check = {
	name: "falls and rises",
	part: "in-betweens",
	run: onSixFrames((_, frames) => {
		const ys = frames.map(centroidY);
		const falling = ys
			.slice(0, BOTTOM_FRAME + 1)
			.every((y, i, all) => i === 0 || y > (all[i - 1] as number));
		const rising = ys
			.slice(BOTTOM_FRAME)
			.every((y, i, all) => i === 0 || y < (all[i - 1] as number));
		return {
			pass: falling && rising,
			detail: `centroid y per frame: ${ys.map((y) => y.toFixed(2)).join(", ")}; needs y increasing over frames 0 to 3 and decreasing over 3 to 5`,
		};
	}),
};

const steadySize: Check = {
	name: "steady size",
	part: "in-betweens",
	run: onSixFrames((_, frames) => {
		const counts = frames.map((frame) => alphaCounts(frame).opaque);
		const first = counts[0] as number;
		const off = [1, 2, 4, 5].filter(
			(frame) =>
				Math.abs((counts[frame] as number) - first) > first * MAX_SIZE_CHANGE,
		);
		const detail = `opaque pixels per frame: ${counts.join(", ")}; frames 1, 2, 4 and 5 must be within ${MAX_SIZE_CHANGE * 100}% of frame 0's ${first}`;
		return { pass: off.length === 0, detail };
	}),
};

const tag: Check = {
	name: "tag",
	part: "tag",
	run: onSpriteOfSize(WIDTH, HEIGHT, (sprite) => {
		const found = sprite.tags.find((candidate) => candidate.name === "bounce");
		if (!found)
			return { pass: false, detail: 'there is no tag named "bounce"' };
		const detail = `tag "bounce" covers frames ${found.from} to ${found.to}, needs 0 to ${FRAMES - 1}`;
		return { pass: found.from === 0 && found.to === FRAMES - 1, detail };
	}),
};

const definition: EvalDefinition = {
	parts: ["key poses", "in-betweens", "tag"],
	checks: [sixFrames, squash, fallsAndRises, steadySize, tag],
};

export default definition;
