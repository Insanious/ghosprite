import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { decodePng } from "./core/png.ts";
import { OpError } from "./errors.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";

describe("callTool", () => {
	test("session.apply gives per-op results", () => {
		const session = new Session();
		const result = callTool(session, "session.apply", {
			ops: [
				{ op: "sprite.create", input: { width: 2, height: 2 } },
				{ op: "layer.create", input: { spriteId: "sprite-1" } },
			],
		}) as { results: unknown[]; checkpointId: string };
		expect(result.results).toHaveLength(2);
		expect(result.checkpointId).toBe("checkpoint-1");
	});

	test("a bad session.undo input is invalid_input with a path", () => {
		const session = new Session();
		try {
			callTool(session, "session.undo", { steps: 0 });
			throw new Error("did not throw");
		} catch (error) {
			expect(error).toBeInstanceOf(OpError);
			expect((error as OpError).code).toBe("invalid_input");
			expect((error as OpError).path).toBe("steps");
		}
	});

	test("other names go to the session's ops", () => {
		const session = new Session();
		const result = callTool(session, "sprite.create", {
			width: 1,
			height: 1,
		}) as { spriteId: string };
		expect(result.spriteId).toBe("sprite-1");
	});

	test("session.journal writes the script when given a path", () => {
		const session = new Session();
		callTool(session, "sprite.create", { width: 1, height: 1 });
		const path = join(mkdtempSync(join(tmpdir(), "tools-")), "j.json");
		callTool(session, "session.journal", { path });
		const script = JSON.parse(readFileSync(path, "utf8"));
		expect(script).toHaveLength(1);
		expect(script[0].op).toBe("sprite.create");
	});
});

describe("sprite.diff", () => {
	function setup(size: number) {
		const session = new Session();
		const { spriteId } = callTool(session, "sprite.create", {
			width: size,
			height: size,
		}) as { spriteId: string };
		const { layerId } = callTool(session, "layer.create", {
			spriteId,
		}) as { layerId: string };
		callTool(session, "cel.set", {
			spriteId,
			layerId,
			frame: 0,
			legend: { x: "#0000ff" },
			rows: ["x"],
		});
		callTool(session, "session.checkpoint", { name: "start" });
		return { session, spriteId, layerId };
	}
	const decode = (png: Uint8Array) => decodePng(png, inflateSync);

	test("one drawn pixel changes one pixel and the PNG is three panels wide", () => {
		const { session, spriteId, layerId } = setup(4);
		callTool(session, "draw.rect", {
			spriteId,
			layerId,
			frame: 0,
			color: "#ff0000",
			rect: { x: 1, y: 1, width: 1, height: 1 },
			filled: true,
		});
		const result = callTool(session, "sprite.diff", {
			spriteId,
			from: "start",
			scale: 2,
		}) as { frames: { png: Uint8Array; changedPixels: number }[] };
		expect(result.frames).toHaveLength(1);
		expect(result.frames[0]?.changedPixels).toBe(1);
		const image = decode(result.frames[0]?.png as Uint8Array);
		expect(image.width).toBe(3 * 4 * 2 + 2);
	});

	test("a resize pads each panel to the larger size", () => {
		const { session, spriteId } = setup(4);
		callTool(session, "sprite.resize", { spriteId, width: 8, height: 8 });
		const result = callTool(session, "sprite.diff", {
			spriteId,
			from: "start",
		}) as { frames: { png: Uint8Array }[] };
		expect(decode(result.frames[0]?.png as Uint8Array).width).toBe(26);
	});

	test("a sprite missing at from is not_found", () => {
		const { session } = setup(4);
		callTool(session, "session.checkpoint", { name: "before" });
		const { spriteId } = callTool(session, "sprite.create", {
			width: 2,
			height: 2,
		}) as { spriteId: string };
		expect(() =>
			callTool(session, "sprite.diff", { spriteId, from: "start" }),
		).toThrow(OpError);
	});

	test("a frame in neither sprite is out_of_range on frames", () => {
		const { session, spriteId } = setup(4);
		try {
			callTool(session, "sprite.diff", {
				spriteId,
				from: "start",
				frames: [5],
			});
			throw new Error("did not throw");
		} catch (error) {
			expect((error as OpError).code).toBe("out_of_range");
			expect((error as OpError).path).toBe("frames");
		}
	});
});

describe("describeTools", () => {
	test("lists ops and session tools with object schemas", () => {
		const tools = describeTools(new Session());
		const names = tools.map((t) => t.name);
		expect(names).toContain("sprite.create");
		expect(names.slice(-7)).toEqual([
			"session.apply",
			"session.undo",
			"session.redo",
			"session.checkpoint",
			"session.restore",
			"session.journal",
			"sprite.diff",
		]);
		for (const tool of tools) {
			expect((tool.inputSchema as { type: string }).type).toBe("object");
		}
	});
});

describe("replaceImages", () => {
	test("replaces nested png keys and keeps everything else", () => {
		const png = new Uint8Array([1, 2]);
		const result = {
			name: "x",
			results: [
				{ changed: [] },
				{
					render: [
						{ frame: 0, png },
						{ frame: 1, png },
					],
				},
			],
			png,
		};
		const paths: unknown[] = [];
		const out = replaceImages(result, (_png, path) => {
			paths.push(path);
			return { key: "path", value: path.join("-") };
		});
		expect(paths).toEqual([
			["results", 1, "render", 0],
			["results", 1, "render", 1],
			[],
		]);
		expect(out).toEqual({
			name: "x",
			results: [
				{ changed: [] },
				{
					render: [
						{ frame: 0, path: "results-1-render-0" },
						{ frame: 1, path: "results-1-render-1" },
					],
				},
			],
			path: "",
		});
		expect(result.png).toBe(png);
	});
});
