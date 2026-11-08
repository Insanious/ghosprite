import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { GifReader } from "omggif";
import { decodeAnimation, decodeRGBA } from "wasm-webp";
import { decodePng } from "../core/png.ts";
import { renderFrame } from "../core/render.ts";
import { upscale } from "../core/upscale.ts";
import { OpError } from "../errors.ts";
import { Workspace } from "../workspace.ts";
import { operations } from "./index.ts";
import { createRegistry } from "./registry.ts";

const registry = createRegistry(operations);
const colors = ["#ff0000", "#00ff00", "#0000ff"];
const durations = [100, 200, 300];

function call(workspace: Workspace, name: string, input: object) {
	return registry.callOp(workspace, name, input) as unknown as Record<
		string,
		string
	>;
}

function failure(run: () => void): OpError {
	try {
		run();
	} catch (error) {
		if (error instanceof OpError) return error;
		throw error;
	}
	throw new Error("expected a failure");
}

function setup() {
	const workspace = new Workspace();
	const { spriteId } = call(workspace, "sprite.create", {
		width: 2,
		height: 2,
		frameCount: 3,
	}) as { spriteId: string };
	const sprite = workspace.getSprite(spriteId);
	sprite.frameDurations.splice(0, 3, ...durations);
	const { layerId } = call(workspace, "layer.create", { spriteId }) as {
		layerId: string;
	};
	for (const [frame, color] of colors.entries()) {
		call(workspace, "cel.set", {
			spriteId,
			layerId,
			frame,
			legend: { a: color },
			rows: ["aa", "aa"],
		});
	}
	call(workspace, "tag.create", { spriteId, name: "tail", from: 1, to: 2 });
	const directory = mkdtempSync(join(tmpdir(), "ghosprite-export-"));
	return { workspace, spriteId, sprite, directory };
}

function withSetup(test: (s: ReturnType<typeof setup>) => void) {
	const s = setup();
	try {
		test(s);
	} finally {
		rmSync(s.directory, { recursive: true, force: true });
	}
}

describe("sprite.export", () => {
	test("a .png writes the chosen frame at scale", () => {
		withSetup(({ workspace, spriteId, sprite, directory }) => {
			const path = join(directory, "f.png");
			call(workspace, "sprite.export", {
				spriteId,
				path,
				frame: 2,
				scale: 3,
			});
			const decoded = decodePng(readFileSync(path), inflateSync);
			const expected = upscale(renderFrame(sprite, 2), 3, false);
			expect(decoded.width).toBe(6);
			expect(Array.from(decoded.data)).toEqual(Array.from(expected.data));
		});
	});

	test("a .GIF with a tag writes only the tag's frames and delays", () => {
		withSetup(({ workspace, spriteId, directory }) => {
			const path = join(directory, "t.GIF");
			call(workspace, "sprite.export", { spriteId, path, tag: "tail" });
			const reader = new GifReader(readFileSync(path));
			expect(reader.numFrames()).toBe(2);
			expect([0, 1].map((i) => reader.frameInfo(i).delay)).toEqual([20, 30]);
		});
	});

	test("a .webp writes all frames with their durations", async () => {
		const { workspace, spriteId, directory } = setup();
		try {
			const path = join(directory, "a.webp");
			call(workspace, "sprite.export", { spriteId, path });
			const decoded = await decodeAnimation(readFileSync(path), true);
			expect(decoded?.map((f) => f.duration)).toEqual(durations);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("a one-frame .webp is a still of the frame", async () => {
		const { workspace, spriteId, sprite, directory } = setup();
		try {
			const path = join(directory, "s.webp");
			call(workspace, "tag.create", { spriteId, name: "one", from: 1, to: 1 });
			call(workspace, "sprite.export", { spriteId, path, tag: "one" });
			const decoded = await decodeRGBA(readFileSync(path));
			expect(Array.from(decoded?.data ?? [])).toEqual(
				Array.from(renderFrame(sprite, 1).data),
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("bad requests fail with their codes", () => {
		withSetup(({ workspace, spriteId, directory }) => {
			const run = (input: object) =>
				failure(() =>
					call(workspace, "sprite.export", {
						spriteId,
						path: join(directory, "x.png"),
						...input,
					}),
				);
			expect(run({ path: join(directory, "x.bmp") }).toJSON()).toMatchObject({
				code: "invalid_input",
				path: "path",
			});
			expect(run({ tag: "tail" }).toJSON()).toMatchObject({
				code: "invalid_input",
				path: "tag",
			});
			expect(
				run({ path: join(directory, "x.gif"), frame: 0 }).toJSON(),
			).toMatchObject({ code: "invalid_input", path: "frame" });
			expect(
				run({ path: join(directory, "x.gif"), tag: "nope" }).toJSON(),
			).toMatchObject({ code: "not_found", path: "tag" });
			expect(run({ frame: 3 }).toJSON()).toMatchObject({
				code: "out_of_range",
				path: "frame",
			});
		});
	});

	test("a scale over the pixel limit is out_of_range", () => {
		withSetup(({ workspace, directory }) => {
			const { spriteId } = call(workspace, "sprite.create", {
				width: 300,
				height: 300,
			}) as { spriteId: string };
			const error = failure(() =>
				call(workspace, "sprite.export", {
					spriteId,
					path: join(directory, "big.png"),
					scale: 64,
				}),
			);
			expect(error.toJSON()).toMatchObject({
				code: "out_of_range",
				path: "scale",
			});
		});
	});
});
