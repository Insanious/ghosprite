import { afterAll, describe, expect, test } from "bun:test";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { version } from "../package.json";
import { decodePng } from "../src/core/index.ts";
import { startRunLog } from "../src/run-log.ts";
import { Session } from "../src/session.ts";
import { callTool } from "../src/tools.ts";

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

const initialize = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: LATEST_PROTOCOL_VERSION,
		capabilities: {},
		clientInfo: { name: "test", version: "0" },
	},
};

function envWith(overrides: Record<string, string>) {
	return { ...process.env, ...overrides };
}

function mcp(
	args: string[],
	env: Record<string, string | undefined>,
	messages: object[] = [],
) {
	return Bun.spawnSync(["bun", "src/cli.ts", "mcp", ...args], {
		env,
		stdin: new TextEncoder().encode(
			messages.map((m) => `${JSON.stringify(m)}\n`).join(""),
		),
		timeout: 10_000,
	});
}

function instructionsOf(proc: { stdout: Buffer }): string {
	const response = proc.stdout
		.toString()
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line))
		.find((message) => message.id === 1);
	return response.result.instructions;
}

function cli(
	args: string[],
	stdin?: string,
	env?: Record<string, string | undefined>,
) {
	const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
		stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
		env,
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
		expect(path).toBe(join(scratch, "2-render-0.png"));
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

	test("session.undo makes the next render show the undone state", async () => {
		const file = scriptFile("undo.json", [
			script[0],
			script[1],
			{
				op: "session.apply",
				input: {
					ops: [
						{
							op: "draw.rect",
							input: {
								spriteId: "sprite-1",
								layerId: "layer-1",
								frame: 0,
								color: "#ff0000",
								rect: { x: 0, y: 0, width: 8, height: 8 },
								filled: true,
								render: { scale: 1 },
							},
						},
					],
				},
			},
			{ op: "session.undo", input: {} },
			{ op: "sprite.render", input: { spriteId: "sprite-1", frames: [0] } },
		]);
		await Bun.sleep(10);
		const { lines, status } = cli(["run", file, "--out", scratch]);
		expect(status).toBe(0);
		const drawn = lines[2].result.results[0].render[0].path;
		expect(drawn).toBe(join(scratch, "2-results-0-render-0.png"));
		const before = decodePng(readFileSync(drawn), inflateSync);
		expect(before.data[3]).toBe(255);
		const after = decodePng(
			readFileSync(lines[4].result.render[0].path),
			inflateSync,
		);
		expect(after.data[3]).toBe(0);
	});

	test("sprite.contactSheet writes one file and prints its path", async () => {
		const file = scriptFile("sheet.json", [
			script[0],
			{ op: "sprite.contactSheet", input: { spriteId: "sprite-1" } },
		]);
		await Bun.sleep(10);
		const { lines } = cli(["run", file, "--out", scratch]);
		const { path } = lines[1].result;
		expect(path).toBe(join(scratch, "1.png"));
		expect(existsSync(path)).toBe(true);
	});

	test("a saved journal replays with run", async () => {
		const journalPath = join(scratch, "journal.json");
		const file = scriptFile("journal-src.json", [
			script[0],
			script[1],
			{ op: "session.journal", input: { path: journalPath } },
		]);
		await Bun.sleep(10);
		expect(cli(["run", file, "--out", scratch]).status).toBe(0);
		const replay = cli(["run", journalPath, "--out", scratch]);
		expect(replay.status).toBe(0);
		expect(replay.lines.length).toBeGreaterThan(0);
	});

	test("malformed JSON exits 2 with usage on stderr", () => {
		const { status, stderr, lines } = cli(["run"], "{nope");
		expect(status).toBe(2);
		expect(stderr).toContain("Usage:");
		expect(lines).toHaveLength(0);
	});
});

describe("cli mcp", () => {
	for (const args of [
		["--viewer", "abc"],
		["--viewer", "0"],
		["--viewer", "7357", "extra"],
		["--other"],
		["--history"],
		["--history", "--viewer"],
		["--history", "a", "--history", "b"],
		["--history", "a", "extra"],
		["--history", "a", "--no-history"],
		["--no-history", "--history", "a"],
		["--viewer", "--no-viewer"],
		["--no-viewer", "--viewer", "7357"],
		["--no-viewer", "--no-viewer"],
		["--no-history", "extra"],
	]) {
		test(`mcp ${args.join(" ")} is a usage error`, () => {
			const env = envWith({ GHOSPRITE_HISTORY: join(scratch, "usage") });
			expect(cli(["mcp", ...args], undefined, env).status).toBe(2);
		});
	}

	test("--viewer exits when stdin closes", async () => {
		const probe = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = probe.port;
		await probe.stop(true);
		const proc = Bun.spawnSync(
			["bun", "src/cli.ts", "mcp", "--viewer", `${port}`, "--no-history"],
			{
				stdin: new TextEncoder().encode(""),
				timeout: 10_000,
			},
		);
		expect(proc.exitCode).toBe(0);
	});

	test("with no history flags the run lands in GHOSPRITE_HISTORY", () => {
		const dir = join(scratch, "env");
		const proc = mcp(["--no-viewer"], envWith({ GHOSPRITE_HISTORY: dir }));
		expect(proc.exitCode).toBe(0);
		expect(readdirSync(dir)).toHaveLength(1);
	});

	test("--history wins over GHOSPRITE_HISTORY", () => {
		const envA = join(scratch, "env-a");
		const envB = join(scratch, "env-b");
		const proc = mcp(
			["--no-viewer", "--history", envB],
			envWith({ GHOSPRITE_HISTORY: envA }),
		);
		expect(proc.exitCode).toBe(0);
		expect(readdirSync(envB)).toHaveLength(1);
		expect(existsSync(envA)).toBe(false);
	});

	test.skipIf(process.platform !== "linux")(
		"an empty GHOSPRITE_HISTORY falls back to XDG_STATE_HOME",
		() => {
			const state = join(scratch, "state");
			const proc = mcp(
				["--no-viewer"],
				envWith({ GHOSPRITE_HISTORY: "", XDG_STATE_HOME: state }),
			);
			expect(proc.exitCode).toBe(0);
			expect(readdirSync(join(state, "ghosprite", "runs"))).toHaveLength(1);
		},
	);

	test("--no-history --no-viewer saves nothing", () => {
		const dir = join(scratch, "off");
		const proc = mcp(
			["--no-history", "--no-viewer"],
			envWith({ GHOSPRITE_HISTORY: dir }),
		);
		expect(proc.exitCode).toBe(0);
		expect(existsSync(dir)).toBe(false);
	});

	test("the viewer is on by default and --no-viewer turns it off", () => {
		const env = envWith({ GHOSPRITE_HISTORY: join(scratch, "unused") });
		const on = instructionsOf(mcp(["--no-history"], env, [initialize]));
		expect(on).toContain("A read-only viewer");
		expect(on).toContain("http://127.0.0.1:");
		const off = instructionsOf(
			mcp(["--no-history", "--no-viewer"], env, [initialize]),
		);
		expect(off).not.toContain("A read-only viewer");
		expect(off).not.toContain("http://127.0.0.1:");
	});

	test("--viewer with --history leaves a run folder holding the version line", async () => {
		const probe = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = probe.port;
		await probe.stop(true);
		const dir = join(scratch, "history-viewer");
		const proc = Bun.spawnSync(
			["bun", "src/cli.ts", "mcp", "--viewer", `${port}`, "--history", dir],
			{ stdin: new TextEncoder().encode(""), timeout: 10_000 },
		);
		expect(proc.exitCode).toBe(0);
		const runs = readdirSync(dir);
		expect(runs).toHaveLength(1);
		const lines = readFileSync(
			join(dir, runs[0] as string, "log.jsonl"),
			"utf8",
		)
			.trim()
			.split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string).kind).toBe("run");
	});

	test("a run with stdin closed leaves no pid file", () => {
		const dir = join(scratch, "history-pid-closed");
		const proc = mcp(["--no-viewer", "--history", dir], process.env);
		expect(proc.exitCode).toBe(0);
		const runs = readdirSync(dir);
		expect(runs).toHaveLength(1);
		expect(existsSync(join(dir, runs[0] as string, "pid"))).toBe(false);
	});

	test("a running server holds a pid file that goes on a clean exit", async () => {
		const dir = join(scratch, "history-pid-live");
		const proc = Bun.spawn(
			["bun", "src/cli.ts", "mcp", "--no-viewer", "--history", dir],
			{ stdin: "pipe", stdout: "pipe", stderr: "ignore" },
		);
		proc.stdin.write(`${JSON.stringify(initialize)}\n`);
		await proc.stdin.flush();
		const reader = proc.stdout.getReader();
		await reader.read();
		const runs = readdirSync(dir);
		expect(runs).toHaveLength(1);
		const pidFile = join(dir, runs[0] as string, "pid");
		expect(readFileSync(pidFile, "utf8")).toBe(String(proc.pid));
		await proc.stdin.end();
		expect(await proc.exited).toBe(0);
		expect(existsSync(pidFile)).toBe(false);
	});

	test("--history records loads, notes and moves, and skips saves", () => {
		const env = envWith({ GHOSPRITE_HISTORY: join(scratch, "unused") });
		const dir = join(scratch, "history-e2e");
		const source = join(scratch, "e2e-source.aseprite");
		copyFileSync("tests/fixtures/doc/base.aseprite", source);
		const saved = join(scratch, "e2e-saved.aseprite");
		const call = (id: number, name: string, args: object) => ({
			jsonrpc: "2.0",
			id,
			method: "tools/call",
			params: { name, arguments: args },
		});
		const messages = [
			initialize,
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			call(2, "sprite_load", { path: source }),
			call(3, "draw_rect", {
				spriteId: "sprite-1",
				layerId: "layer-2",
				frame: 0,
				color: "#ff0000",
				rect: { x: 0, y: 0, width: 1, height: 1 },
				filled: true,
				note: "dot",
			}),
			call(4, "session_undo", {}),
			call(5, "sprite_save", { spriteId: "sprite-1", path: saved }),
		];
		const proc = mcp(["--no-viewer", "--history", dir], env, messages);
		expect(proc.exitCode).toBe(0);
		const runs = readdirSync(dir);
		expect(runs).toHaveLength(1);
		const folder = join(dir, runs[0] as string);
		const lines = readFileSync(join(folder, "log.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines[0].kind).toBe("run");
		const load = lines.find((l) => l.op === "sprite.load");
		expect(readFileSync(join(folder, load.input.path))).toEqual(
			readFileSync(source),
		);
		expect(load.loadedFrom).toEqual({ [load.input.path]: source });
		expect(lines.find((l) => l.op === "draw.rect").note).toBe("dot");
		expect(lines).toContainEqual({
			kind: "moved",
			checkpointId: "checkpoint-1",
		});
		expect(lines.some((l) => l.op === "sprite.save")).toBe(false);
	});
});

describe("cli view", () => {
	function savedRun(name: string, date?: Date): string {
		const dir = join(scratch, name);
		const source = join(scratch, `${name}-source.aseprite`);
		copyFileSync("tests/fixtures/doc/base.aseprite", source);
		const runLog = startRunLog(dir, date);
		const session = new Session({ onLog: (entry) => runLog.append(entry) });
		callTool(session, "sprite.load", { path: source });
		callTool(session, "draw.rect", {
			spriteId: "sprite-1",
			layerId: "layer-2",
			frame: 0,
			color: "#ff0000",
			rect: { x: 0, y: 0, width: 1, height: 1 },
			filled: true,
		});
		session.undo();
		return join(dir, runLog.name);
	}

	async function serve<T>(
		args: string[],
		use: (url: string) => Promise<T>,
		env?: Record<string, string | undefined>,
	): Promise<T> {
		const probe = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = probe.port;
		await probe.stop(true);
		const proc = Bun.spawn(
			["bun", "src/cli.ts", "view", ...args, "--port", `${port}`],
			{ stdout: "pipe", stderr: "pipe", env },
		);
		try {
			const reader = proc.stdout.getReader();
			const { value } = await reader.read();
			return await use(new TextDecoder().decode(value).trim());
		} finally {
			proc.kill();
			await proc.exited;
		}
	}

	test("serves the saved run with pictures and the abandoned step off the path", async () => {
		const folder = savedRun("view-run");
		await serve([folder], async (url) => {
			const log = (await (await fetch(`${url}log`)).json()) as {
				kind: string;
				checkpointId: string;
				op?: string;
				onPath?: boolean;
				hasPicture?: boolean;
			}[];
			expect(log.map((e) => [e.kind, e.checkpointId, e.op])).toEqual([
				["step", "checkpoint-1", "sprite.load"],
				["step", "checkpoint-2", "draw.rect"],
				["moved", "checkpoint-1", undefined],
			]);
			const steps = log.filter((e) => e.kind === "step");
			expect(steps.map((e) => e.hasPicture)).toEqual([true, true]);
			expect(steps.map((e) => e.onPath)).toEqual([true, false]);
			const html = await (await fetch(url)).text();
			expect(html).toContain(basename(folder));
			expect(html).not.toContain("saved by ghosprite");
		});
	});

	test("a log from another version puts both versions on the page", async () => {
		const folder = savedRun("view-version");
		const path = join(folder, "log.jsonl");
		const lines = readFileSync(path, "utf8").split("\n");
		lines[0] = JSON.stringify({
			...JSON.parse(lines[0] as string),
			version: "9.9.9",
		});
		writeFileSync(path, lines.join("\n"));
		await serve([`${folder}/`], async (url) => {
			const html = await (await fetch(url)).text();
			expect(html).toContain("ghosprite 9.9.9");
			expect(html).toContain(`this is ghosprite ${version}`);
			expect(html).toContain(basename(folder));
		});
	});

	for (const args of [
		["a", "b"],
		["a", "--port", "abc"],
		["a", "--port", "0"],
	]) {
		test(`view ${args.join(" ")} is a usage error`, () => {
			expect(cli(["view", ...args]).status).toBe(2);
		});
	}

	test("with no folder it serves the newest run in the history folder", async () => {
		const history = join(scratch, "view-latest");
		const newer = savedRun("view-latest", new Date("2026-01-02T00:00:00Z"));
		const older = savedRun("view-latest", new Date("2026-01-01T00:00:00Z"));
		await serve(
			[],
			async (url) => {
				const html = await (await fetch(url)).text();
				expect(html).toContain(basename(newer));
				expect(html).not.toContain(basename(older));
			},
			envWith({ GHOSPRITE_HISTORY: history }),
		);
	});

	test("with no folder and no runs in the history folder it exits 2 naming it", () => {
		const empty = join(scratch, "view-history-empty");
		mkdirSync(empty);
		for (const dir of [empty, join(scratch, "view-history-missing")]) {
			const { status, stderr } = cli(
				["view"],
				undefined,
				envWith({ GHOSPRITE_HISTORY: dir }),
			);
			expect(status).toBe(2);
			expect(stderr).toContain(dir);
		}
	});

	test("view --port 0 with no folder is a usage error", () => {
		const { status } = cli(
			["view", "--port", "0"],
			undefined,
			envWith({ GHOSPRITE_HISTORY: join(scratch, "view-history-port") }),
		);
		expect(status).toBe(2);
	});

	test("a folder with no log.jsonl exits 1", () => {
		const empty = join(scratch, "view-empty");
		mkdirSync(empty);
		const { status, stderr } = cli(["view", empty]);
		expect(status).toBe(1);
		expect(stderr).toContain(empty);
	});
});

describe("cli ops", () => {
	test("lists the ops and the session tools", () => {
		const proc = Bun.spawnSync(["bun", "src/cli.ts", "ops"]);
		const ops = JSON.parse(proc.stdout.toString());
		const names = ops.map((o: { name: string }) => o.name);
		expect(names).toContain("session.apply");
		expect(names).toContain("sprite.diff");
		expect(names.slice(0, 39)).toEqual([
			"sprite.create",
			"layer.create",
			"layer.delete",
			"layer.mergeDown",
			"layer.move",
			"sprite.flatten",
			"cel.set",
			"cel.get",
			"cel.delete",
			"cel.link",
			"cel.unlink",
			"frame.create",
			"frame.duplicate",
			"frame.delete",
			"draw.line",
			"draw.image",
			"draw.pixels",
			"draw.bezier",
			"draw.polygon",
			"draw.rect",
			"draw.ellipse",
			"draw.fill",
			"draw.spray",
			"sprite.rotate",
			"sprite.flip",
			"sprite.render",
			"sprite.contactSheet",
			"sprite.load",
			"sprite.resize",
			"sprite.save",
			"sprite.export",
			"sprite.exportSheet",
			"tag.create",
			"tag.delete",
			"slice.create",
			"slice.delete",
			"sprite.crop",
			"sprite.trim",
			"sprite.describe",
		]);
	});
});
