import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runChecks } from "../../src/eval/checks.ts";
import { Session } from "../../src/session.ts";
import definition from "./eval.ts";

type Built = { session: Session; spriteId: string; house: string };

const FIXTURE = join(import.meta.dir, "files", "cottage.aseprite");

function load(): Built {
	const session = new Session();
	const { spriteId } = session.run("sprite.load", {
		path: FIXTURE,
	}) as unknown as { spriteId: string };
	const sprite = session.workspace.getSprite(spriteId);
	const house = (sprite.root.children[0] as { id: string }).id;
	return { session, spriteId, house };
}

function rect(
	{ session, spriteId, house }: Built,
	color: string,
	x: number,
	y: number,
	width: number,
	height: number,
	layerId = house,
) {
	session.run("draw.rect", {
		spriteId,
		layerId,
		frame: 0,
		color,
		rect: { x, y, width, height },
		filled: true,
	});
}

function paintRoof(built: Built, dark: string, light: string) {
	rect(built, dark, 8, 10, 16, 3);
	rect(built, light, 4, 13, 24, 3);
}

function paintDoorAt(built: Built, shift: number) {
	rect(built, "#e8d4a0", 8, 21, 5, 8);
	rect(built, "#7a4a28", 8 + shift, 21, 5, 8);
}

function addSmoke(built: Built, color: string, y = 2) {
	const { layerId } = built.session.run("layer.create", {
		spriteId: built.spriteId,
		name: "smoke",
	}) as unknown as { layerId: string };
	rect(built, color, 12, y, 6, 5, layerId);
}

function edited(): Built {
	const built = load();
	paintRoof(built, "#2a3ab0", "#4864d0");
	paintDoorAt(built, 4);
	addSmoke(built, "#80808080");
	return built;
}

function results({ session, spriteId }: Built) {
	const outcome = runChecks(definition, [
		session.workspace.getSprite(spriteId),
	]);
	return Object.fromEntries(
		outcome.checks.map((check) => [check.name, check.pass]),
	);
}

const allPass = {
	loaded: true,
	"blue roof": true,
	"moved door": true,
	smoke: true,
};

describe("edit-cottage eval", () => {
	test("the fixture has a layer named house and the parts the checks rely on", () => {
		const { session, spriteId } = load();
		const sprite = session.workspace.getSprite(spriteId);
		expect(sprite.width).toBe(32);
		expect(sprite.height).toBe(32);
		expect(sprite.root.children.map((layer) => layer.name)).toEqual(["house"]);
	});

	test("the full edit passes everything", () => {
		expect(results(edited())).toEqual(allPass);
	});

	test("the untouched fixture passes only loaded", () => {
		expect(results(load())).toEqual({
			loaded: true,
			"blue roof": false,
			"moved door": false,
			smoke: false,
		});
	});

	test("a door moved with its old place left transparent fails moved door only", () => {
		const built = load();
		paintRoof(built, "#2a3ab0", "#4864d0");
		addSmoke(built, "#80808080");
		const { session, spriteId, house } = built;
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 8, y: 21, width: 5, height: 8 } },
		}) as unknown as { selectionId: string };
		session.run("region.move", {
			spriteId,
			layerId: house,
			frames: [0],
			selectionId,
			dx: 4,
			dy: 0,
		});
		expect(results(built)).toEqual({ ...allPass, "moved door": false });
	});

	test("a door moved 3 pixels fails moved door only", () => {
		const built = load();
		paintRoof(built, "#2a3ab0", "#4864d0");
		paintDoorAt(built, 3);
		addSmoke(built, "#80808080");
		expect(results(built)).toEqual({ ...allPass, "moved door": false });
	});

	test("a roof turned one flat blue fails blue roof only", () => {
		const built = load();
		paintRoof(built, "#3050c0", "#3050c0");
		paintDoorAt(built, 4);
		addSmoke(built, "#80808080");
		expect(results(built)).toEqual({ ...allPass, "blue roof": false });
	});

	test("a red roof fails blue roof only", () => {
		const built = load();
		paintDoorAt(built, 4);
		addSmoke(built, "#80808080");
		expect(results(built)).toEqual({ ...allPass, "blue roof": false });
	});

	test("opaque smoke fails smoke only", () => {
		const built = load();
		paintRoof(built, "#2a3ab0", "#4864d0");
		paintDoorAt(built, 4);
		addSmoke(built, "#808080");
		expect(results(built)).toEqual({ ...allPass, smoke: false });
	});

	test("smoke below the roof's top row fails smoke only", () => {
		const built = load();
		paintRoof(built, "#2a3ab0", "#4864d0");
		paintDoorAt(built, 4);
		addSmoke(built, "#80808080", 17);
		expect(results(built)).toEqual({ ...allPass, smoke: false });
	});

	test("a changed wall pixel fails loaded only", () => {
		const built = edited();
		rect(built, "#ff00ff", 22, 26, 1, 1);
		expect(results(built)).toEqual({ ...allPass, loaded: false });
	});

	test("with no cottage sprite every check fails with that reason", () => {
		const session = new Session();
		const { spriteId } = session.run("sprite.create", {
			width: 16,
			height: 16,
		}) as unknown as { spriteId: string };
		const outcome = runChecks(definition, [
			session.workspace.getSprite(spriteId),
		]);
		for (const check of outcome.checks) {
			expect(check.pass).toBe(false);
			expect(check.detail).toBe('no 32x32 sprite with a layer named "house"');
		}
	});
});
