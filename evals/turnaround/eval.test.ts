import { describe, expect, test } from "bun:test";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Built = { session: Session; spriteId: string; layerId: string };

type Pose = {
	legRows?: number;
	body?: { x: number; width: number };
	chest?: string;
	eyes?: boolean;
};

function build(frames: number): Built {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 16,
		height: 24,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
	}) as unknown as { layerId: string };
	for (let i = 1; i < frames; i++) session.run("frame.create", { spriteId });
	return { session, spriteId, layerId };
}

function rect(
	{ session, spriteId, layerId }: Built,
	frame: number,
	color: string,
	x: number,
	y: number,
	width: number,
	height: number,
) {
	session.run("draw.rect", {
		spriteId,
		layerId,
		frame,
		color,
		rect: { x, y, width, height },
		filled: true,
	});
}

function front(built: Built, frame: number, pose: Pose = {}) {
	const { legRows = 6, chest = "#00ff00", eyes = true } = pose;
	rect(built, frame, "#808080", 7, 0, 2, 2);
	rect(built, frame, "#a0a0a0", 5, 2, 6, 5);
	rect(built, frame, "#606060", 4, 7, 8, 7);
	rect(built, frame, "#707070", 3, 7, 1, 6);
	rect(built, frame, "#707070", 12, 7, 1, 6);
	rect(built, frame, "#404040", 5, 14, 2, legRows);
	rect(built, frame, "#404040", 9, 14, 2, legRows);
	rect(built, frame, chest, 6, 8, 4, 3);
	if (eyes) {
		rect(built, frame, "#ffff00", 6, 4, 1, 1);
		rect(built, frame, "#ffff00", 9, 4, 1, 1);
	}
}

function side(built: Built, frame: number, width = 6) {
	rect(built, frame, "#808080", 7, 0, 2, 2);
	rect(built, frame, "#a0a0a0", 5, 2, 6, 5);
	rect(built, frame, "#606060", 8 - width / 2, 7, width, 7);
	rect(built, frame, "#707070", 7, 7, 2, 6);
	rect(built, frame, "#404040", 5, 14, 2, 6);
	rect(built, frame, "#404040", 9, 14, 2, 6);
	if (width > 6) {
		rect(built, frame, "#707070", 3, 7, 1, 6);
		rect(built, frame, "#707070", 12, 7, 1, 6);
	}
}

function robot(): Built {
	const built = build(3);
	front(built, 0);
	side(built, 1);
	front(built, 2, { chest: "#ff0000", eyes: false });
	return built;
}

function run({ session, spriteId }: Built) {
	return runChecks(definition, [session.workspace.getSprite(spriteId)]);
}

function failed(built: Built): string[] {
	return run(built)
		.checks.filter((check) => !check.pass)
		.map((check) => check.name);
}

describe("turnaround eval", () => {
	test("a symmetric front, a narrower side and a recoloured back pass everything", () => {
		const outcome = run(robot());
		expect(outcome.checks.map((check) => check.pass)).toEqual([
			true,
			true,
			true,
			true,
			true,
		]);
		expect(outcome.unchecked).toEqual([]);
	});

	test("two frames fail every check with the frame count", () => {
		const built = build(2);
		front(built, 0);
		side(built, 1);
		const outcome = run(built);
		expect(outcome.checks.every((check) => !check.pass)).toBe(true);
		for (const check of outcome.checks) {
			expect(check.detail).toBe("2 frames, needs 3");
		}
	});

	test("an empty third frame fails every check", () => {
		const built = build(3);
		front(built, 0);
		side(built, 1);
		const outcome = run(built);
		expect(outcome.checks.every((check) => !check.pass)).toBe(true);
		expect(outcome.checks[0]?.detail).toContain("frame 2 has no opaque pixel");
	});

	test("a side as wide as the front fails side narrower only", () => {
		const built = build(3);
		front(built, 0);
		side(built, 1, 8);
		front(built, 2, { chest: "#ff0000", eyes: false });
		expect(failed(built)).toEqual(["side narrower"]);
	});

	test("a back identical to the front fails back differs only", () => {
		const built = build(3);
		front(built, 0);
		side(built, 1);
		front(built, 2);
		expect(failed(built)).toEqual(["back differs"]);
	});

	test("a back 4 pixels shorter fails same height only", () => {
		const built = build(3);
		front(built, 0);
		side(built, 1);
		front(built, 2, { chest: "#ff0000", eyes: false, legRows: 2 });
		expect(failed(built)).toEqual(["same height"]);
	});

	test("a lopsided front fails front symmetric", () => {
		const built = build(3);
		front(built, 0);
		rect(built, 0, "#ff00ff", 3, 7, 4, 10);
		side(built, 1);
		front(built, 2, { chest: "#ff0000", eyes: false });
		expect(failed(built)).toContain("front symmetric");
	});

	test("no 16x24 sprite fails every check with that reason", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 16,
			height: 16,
		}) as unknown as { spriteId: string };
		const outcome = runChecks(definition, [
			session.workspace.getSprite(spriteId),
		]);
		for (const check of outcome.checks) {
			expect(check.detail).toBe("no 16x24 sprite");
		}
	});
});
