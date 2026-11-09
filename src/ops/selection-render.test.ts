import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { decodePng } from "../core/png.ts";
import { OpError } from "../errors.ts";
import { Session } from "../session.ts";

type Rendered = { render: { frame: number; png: Uint8Array }[] };

function setup() {
	const session = new Session();
	const { spriteId } = session.run("sprite.create", {
		width: 4,
		height: 4,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as { layerId: string };
	session.run("draw.rect", {
		spriteId,
		layerId,
		frame: 0,
		rect: { x: 0, y: 0, width: 1, height: 1 },
		filled: true,
		color: "#00ff00",
	});
	return { session, spriteId, layerId };
}

function pngData(result: unknown): Uint8Array {
	const png = (result as Rendered).render[0]?.png;
	if (!png) throw new Error("no render");
	return decodePng(png, inflateSync).data;
}

function pixelAt(data: Uint8Array, width: number, x: number, y: number) {
	const at = (y * width + x) * 4;
	return [...data.subarray(at, at + 4)];
}

function failure(fn: () => unknown): OpError {
	try {
		fn();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected an OpError");
}

describe("selection highlight on renders", () => {
	test("selection.create tints selected pixels, including transparent ones", () => {
		const { session, spriteId } = setup();
		const plain = pngData(session.run("sprite.render", { spriteId, scale: 1 }));
		const tinted = pngData(
			session.run("selection.create", {
				spriteId,
				shape: { rect: { x: 0, y: 0, width: 2, height: 1 } },
				render: { scale: 1 },
			}),
		);
		expect(pixelAt(tinted, 4, 0, 0)).not.toEqual(pixelAt(plain, 4, 0, 0));
		expect(pixelAt(plain, 4, 1, 0)).toEqual([0, 0, 0, 0]);
		expect(pixelAt(tinted, 4, 1, 0)).toEqual([255, 0, 255, 128]);
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 4; x++) {
				if (y === 0 && x < 2) continue;
				expect(pixelAt(tinted, 4, x, y)).toEqual(pixelAt(plain, 4, x, y));
			}
		}
	});

	test("a draw op with render.selectionId highlights it", () => {
		const { session, spriteId, layerId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 3, y: 3, width: 1, height: 1 } },
		}) as unknown as { selectionId: string };
		const data = pngData(
			session.run("draw.rect", {
				spriteId,
				layerId,
				frame: 0,
				rect: { x: 0, y: 0, width: 1, height: 1 },
				filled: true,
				color: "#00ff00",
				render: { scale: 1, selectionId },
			}),
		);
		expect(pixelAt(data, 4, 3, 3)).toEqual([255, 0, 255, 128]);
	});

	test("sprite.render highlights a selection", () => {
		const { session, spriteId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { all: true },
		}) as unknown as { selectionId: string };
		const data = pngData(
			session.run("sprite.render", { spriteId, scale: 1, selectionId }),
		);
		expect(pixelAt(data, 4, 2, 2)).toEqual([255, 0, 255, 128]);
	});

	test("a selection highlight still shows over a background", () => {
		const { session, spriteId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 3, y: 3, width: 1, height: 1 } },
		}) as unknown as { selectionId: string };
		const data = pngData(
			session.run("sprite.render", {
				spriteId,
				scale: 1,
				selectionId,
				background: "#ffffff",
			}),
		);
		expect(pixelAt(data, 4, 3, 3)).toEqual([255, 127, 255, 255]);
		expect(pixelAt(data, 4, 1, 1)).toEqual([255, 255, 255, 255]);
	});

	test("sprite.render rejects {index} as a background at background", () => {
		const { session, spriteId } = setup();
		const error = failure(() =>
			session.run("sprite.render", { spriteId, background: { index: 1 } }),
		);
		expect(error.code).toBe("invalid_input");
		expect(error.path).toBe("background");
	});

	test("selection.combine shows the combined mask", () => {
		const { session, spriteId } = setup();
		const { selectionId } = session.run("selection.create", {
			spriteId,
			shape: { rect: { x: 0, y: 0, width: 1, height: 1 } },
		}) as unknown as { selectionId: string };
		const data = pngData(
			session.run("selection.combine", {
				spriteId,
				selectionId,
				shape: { rect: { x: 2, y: 2, width: 1, height: 1 } },
				mode: "add",
				render: { scale: 1, selectionId },
			}),
		);
		expect(pixelAt(data, 4, 2, 2)).toEqual([255, 0, 255, 128]);
	});

	test("an unknown render.selectionId is not_found", () => {
		const { session, spriteId } = setup();
		const error = failure(() =>
			session.run("selection.create", {
				spriteId,
				shape: { all: true },
				render: { scale: 1, selectionId: "selection-9" },
			}),
		);
		expect(error.code).toBe("not_found");
		expect(error.path).toBe("render.selectionId");
	});
});
