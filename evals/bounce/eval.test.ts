import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Pose = { x: number; y: number; width: number; height: number };

const ball = (y: number): Pose => ({ x: 5, y, width: 6, height: 6 });
const squashed: Pose = { x: 2, y: 28, width: 12, height: 4 };
const goodPoses = [ball(0), ball(6), ball(12), squashed, ball(14), ball(6)];

function build(
	poses: Pose[],
	tag: { from: number; to: number } | null = { from: 0, to: poses.length - 1 },
	width = 16,
) {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width,
		height: 32,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	for (let frame = 1; frame < poses.length; frame++) {
		session.run("frame.create", { spriteId });
	}
	poses.forEach((rect, frame) => {
		session.run("draw.rect", {
			spriteId,
			layerId,
			frame,
			color: "#ff0000",
			rect,
			filled: true,
		});
	});
	if (tag) session.run("tag.create", { spriteId, name: "bounce", ...tag });
	return runChecks(definition, [session.workspace.getSprite(spriteId)]);
}

function failing(outcome: ReturnType<typeof build>): string[] {
	return outcome.checks.filter((check) => !check.pass).map((c) => c.name);
}

describe("bounce eval", () => {
	test("six frames moving down then up with a wide bottom frame and the tag pass", () => {
		const outcome = build(goodPoses);
		expect(failing(outcome)).toEqual([]);
		expect(outcome.unchecked).toEqual([]);
	});

	test("frame 2 above frame 1 fails only falls and rises", () => {
		const poses = [...goodPoses];
		poses[2] = ball(3);
		expect(failing(build(poses))).toEqual(["falls and rises"]);
	});

	test("a round frame 3 fails only squash", () => {
		const poses = [...goodPoses];
		poses[3] = ball(26);
		expect(failing(build(poses))).toEqual(["squash"]);
	});

	test("a tag over frames 0 to 4 fails only tag", () => {
		expect(failing(build(goodPoses, { from: 0, to: 4 }))).toEqual(["tag"]);
	});

	test("no tag fails only tag", () => {
		expect(failing(build(goodPoses, null))).toEqual(["tag"]);
	});

	test("a ball that shrinks in frame 4 fails only steady size", () => {
		const poses = [...goodPoses];
		poses[4] = { x: 7, y: 14, width: 2, height: 2 };
		expect(failing(build(poses))).toEqual(["steady size"]);
	});

	test("five frames fail every check, naming the count", () => {
		const outcome = build(goodPoses.slice(0, 5));
		expect(failing(outcome)).toEqual(outcome.checks.map((c) => c.name));
		expect(outcome.checks[0]?.detail).toContain("5 frames");
	});

	test("a 32x32 sprite fails every check with that reason", () => {
		const outcome = build(goodPoses, null, 32);
		for (const check of outcome.checks) {
			expect(check.pass).toBe(false);
			expect(check.detail).toBe("no 16x32 sprite");
		}
	});
});
