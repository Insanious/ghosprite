import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("describeTools", () => {
	test("lists ops and session tools with object schemas", () => {
		const tools = describeTools(new Session());
		const names = tools.map((t) => t.name);
		expect(names).toContain("sprite.create");
		expect(names.slice(-6)).toEqual([
			"session.apply",
			"session.undo",
			"session.redo",
			"session.checkpoint",
			"session.restore",
			"session.journal",
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
