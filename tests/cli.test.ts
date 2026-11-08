import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { decodePng } from "../src/core/png.ts";

const scratch = mkdtempSync(join(tmpdir(), "ghosprite-cli-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const script = [
	{ op: "sprite.create", input: { width: 8, height: 8, frameCount: 2 } },
	{ op: "layer.create", input: { spriteId: "sprite-1", name: "body" } },
	{
		op: "sprite.render",
		input: { spriteId: "sprite-1", scale: 4, frames: [1] },
	},
];

function cli(args: string[], stdin?: string) {
	const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
		stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
	});
	const lines = proc.stdout
		.toString()
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line));
	return { lines, status: proc.exitCode, stderr: proc.stderr.toString() };
}

function scriptFile(name: string, calls: unknown): string {
	const path = join(scratch, name);
	Bun.write(path, JSON.stringify(calls));
	return path;
}

describe("cli run", () => {
	test("a three-call script prints three result lines", async () => {
		const file = scriptFile("three.json", script);
		await Bun.sleep(10);
		const { lines, status } = cli(["run", file, "--out", scratch]);
		expect(status).toBe(0);
		expect(lines.map((l) => l.op)).toEqual(script.map((c) => c.op));
		expect(lines.every((l) => "result" in l)).toBe(true);
	});

	test("returned paths exist and decode to the expected size", async () => {
		const file = scriptFile("size.json", script);
		await Bun.sleep(10);
		const { lines } = cli(["run", file, "--out", scratch]);
		const [{ frame, path }] = lines[2].result.render;
		expect(frame).toBe(1);
		expect(path).toBe(join(scratch, "2-sprite-1-f1.png"));
		expect(existsSync(path)).toBe(true);
		const image = decodePng(readFileSync(path), inflateSync);
		expect([image.width, image.height]).toEqual([32, 32]);
	});

	test("without --out the PNGs go to a temp directory", () => {
		const { lines } = cli(["run"], JSON.stringify(script));
		expect(existsSync(lines[2].result.render[0].path)).toBe(true);
	});

	test("a failing second call prints one result and one error, and exits 1", async () => {
		const file = scriptFile("fail.json", [
			script[0],
			{ op: "layer.create", input: { spriteId: "sprite-9", name: "x" } },
			script[2],
		]);
		await Bun.sleep(10);
		const { lines, status } = cli(["run", file, "--out", scratch]);
		expect(status).toBe(1);
		expect(lines).toHaveLength(2);
		expect(lines[0].result).toBeDefined();
		expect(lines[1].op).toBe("layer.create");
		expect(lines[1].error.code).toBe("not_found");
		expect(lines[1].error.path).toBe("spriteId");
	});

	test("reads the script from stdin", () => {
		const { lines, status } = cli(
			["run", "-", "--out", scratch],
			JSON.stringify(script),
		);
		expect(status).toBe(0);
		expect(lines).toHaveLength(3);
	});

	test("loads a fixture with a render, then saves it", async () => {
		const target = join(scratch, "saved.aseprite");
		const file = scriptFile("load-save.json", [
			{
				op: "sprite.load",
				input: {
					path: "tests/fixtures/sprites/groups3abc.aseprite",
					render: { scale: 8, grid: true },
				},
			},
			{ op: "sprite.save", input: { spriteId: "sprite-1", path: target } },
		]);
		await Bun.sleep(10);
		const { lines, status } = cli(["run", file, "--out", scratch]);
		expect(status).toBe(0);
		expect(lines).toHaveLength(2);
		expect(lines[0].result.spriteId).toBe("sprite-1");
		expect(existsSync(lines[0].result.render[0].path)).toBe(true);
		expect(existsSync(target)).toBe(true);
	});

	test("malformed JSON exits 2 with usage on stderr", () => {
		const { status, stderr, lines } = cli(["run"], "{nope");
		expect(status).toBe(2);
		expect(stderr).toContain("Usage:");
		expect(lines).toHaveLength(0);
	});
});

describe("cli ops", () => {
	test("lists all six ops", () => {
		const proc = Bun.spawnSync(["bun", "src/cli.ts", "ops"]);
		const ops = JSON.parse(proc.stdout.toString());
		expect(ops.map((o: { name: string }) => o.name)).toEqual([
			"sprite.create",
			"layer.create",
			"cel.set",
			"draw.line",
			"draw.bezier",
			"draw.polygon",
			"draw.rect",
			"draw.ellipse",
			"draw.fill",
			"sprite.render",
			"sprite.load",
			"sprite.save",
		]);
	});
});
