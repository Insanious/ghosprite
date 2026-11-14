import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../../package.json";
import { PID_FILE, startRunLog } from "../run-log.ts";
import { Session } from "../session.ts";
import { startGallery } from "./gallery.ts";

const scratch = mkdtempSync(join(tmpdir(), "ghosprite-gallery-test-"));
const stops: (() => void)[] = [];
afterAll(() => {
	for (const stop of stops) stop();
	rmSync(scratch, { recursive: true, force: true });
});

let counter = 0;

function history(): string {
	const dir = join(scratch, `history-${counter++}`);
	mkdirSync(dir);
	return dir;
}

function buildRun(
	dir: string,
	build: (session: Session) => void,
	now = new Date(),
): string {
	const runLog = startRunLog(dir, now);
	build(new Session({ onLog: (entry) => runLog.append(entry) }));
	return runLog.folder;
}

function twoSprites(session: Session): void {
	session.run("sprite.create", { width: 4, height: 4 });
	session.run("sprite.create", { width: 6, height: 5 });
}

function serve(dir: string): string {
	const gallery = startGallery(dir, 0);
	stops.push(gallery.stop);
	return gallery.url;
}

function rewriteLines(
	folder: string,
	change: (lines: string[]) => string[],
): void {
	const path = join(folder, "log.jsonl");
	const lines = readFileSync(path, "utf8").split("\n").slice(0, -1);
	writeFileSync(path, `${change(lines).join("\n")}\n`);
}

function breakStep(line: string | undefined, checkpointId: string): string {
	return JSON.stringify({ ...JSON.parse(line as string), checkpointId });
}

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second));

describe("startGallery", () => {
	test("/runs lists runs newest first and hides one with only a version line", async () => {
		const dir = history();
		buildRun(dir, twoSprites, at(1));
		buildRun(dir, twoSprites, at(3));
		buildRun(dir, () => {}, at(5));
		const url = serve(dir);
		const runs = (await (await fetch(`${url}runs`)).json()) as {
			name: string;
		}[];
		expect(runs.map((run) => run.name)).toEqual([
			"2026-01-01T00-00-03",
			"2026-01-01T00-00-01",
		]);
	});

	test("a missing history folder serves an empty list", async () => {
		const url = serve(join(scratch, "missing"));
		expect(await (await fetch(`${url}runs`)).json()).toEqual([]);
	});

	test("live comes from the pid file", async () => {
		const dir = history();
		const live = buildRun(dir, twoSprites, at(1));
		buildRun(dir, twoSprites, at(2));
		writeFileSync(join(live, PID_FILE), String(process.pid));
		const url = serve(dir);
		const runs = (await (await fetch(`${url}runs`)).json()) as {
			name: string;
			live: boolean;
		}[];
		expect(runs.map((run) => [run.name, run.live])).toEqual([
			["2026-01-01T00-00-02", false],
			["2026-01-01T00-00-01", true],
		]);
	});

	test("resumedFrom names the source and says whether it is in the gallery", async () => {
		const dir = history();
		const source = buildRun(dir, twoSprites, at(1));
		const inside = buildRun(dir, twoSprites, at(2));
		const outside = buildRun(dir, twoSprites, at(3));
		const resumed = (folder: string, run: string) =>
			rewriteLines(folder, (lines) => [
				lines[0] as string,
				JSON.stringify({ kind: "resumed", run, step: 2 }),
				...lines.slice(1),
			]);
		resumed(inside, source);
		resumed(outside, join(scratch, "elsewhere", "2026-01-01T00-00-00"));
		const url = serve(dir);
		const runs = (await (await fetch(`${url}runs`)).json()) as {
			name: string;
			resumedFrom?: unknown;
		}[];
		expect(runs.map((run) => run.resumedFrom)).toEqual([
			{ run: "2026-01-01T00-00-00", step: 2, inGallery: false },
			{ run: "2026-01-01T00-00-01", step: 2, inGallery: true },
			undefined,
		]);
	});

	test("a run's sprites are listed and the thumbnails are PNGs", async () => {
		const dir = history();
		const folder = buildRun(dir, twoSprites);
		const name = folder.split("/").at(-1);
		const url = serve(dir);
		const body = (await (await fetch(`${url}${name}/sprites`)).json()) as {
			sprites: { page: string; thumbnail: string }[];
			warnings: string[];
		};
		expect(body.sprites).toHaveLength(2);
		expect(body.warnings).toEqual([]);
		for (const sprite of body.sprites) {
			const response = await fetch(
				`${url}${name}/${sprite.page}/steps/${sprite.thumbnail}.png`,
			);
			expect(response.headers.get("content-type")).toBe("image/png");
			const png = new Uint8Array(await response.arrayBuffer());
			expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
		}
	});

	test("a sprite's log holds only its steps and follows a live run", async () => {
		const dir = history();
		const folder = buildRun(dir, twoSprites);
		const name = folder.split("/").at(-1);
		const url = serve(dir);
		const steps = async () =>
			(
				(await (await fetch(`${url}${name}/checkpoint-1/log`)).json()) as {
					checkpointId: string;
				}[]
			).map((entry) => entry.checkpointId);
		expect(await steps()).toEqual(["checkpoint-1"]);
		const next = new Session();
		next.run("sprite.create", { width: 4, height: 4 });
		next.run("sprite.create", { width: 6, height: 5 });
		const layer = next.run("layer.create", { spriteId: "sprite-1", name: "a" });
		const path = join(folder, "log.jsonl");
		writeFileSync(
			path,
			`${readFileSync(path, "utf8")}${JSON.stringify({
				kind: "step",
				checkpointId: layer.checkpointId,
				op: "layer.create",
				input: { spriteId: "sprite-1", name: "a" },
				sprites: ["sprite-1"],
			})}\n`,
		);
		expect(await steps()).toEqual(["checkpoint-1", "checkpoint-3"]);
	});

	test("a path outside the folder and an unknown page are 404", async () => {
		const dir = history();
		const folder = buildRun(dir, twoSprites);
		const name = folder.split("/").at(-1);
		const url = serve(dir);
		const status = async (path: string) =>
			(await fetch(`${url}${path}`)).status;
		expect(await status("..%2Fx/sprites")).toBe(404);
		expect(await status("x/sprites")).toBe(404);
		expect(await status(`${name}/checkpoint-9`)).toBe(404);
		expect(await status(`${name}/checkpoint-9/log`)).toBe(404);
		expect(await status(`${name}/checkpoint-1/steps/checkpoint-2.png`)).toBe(
			404,
		);
		expect(await status(`${name}/checkpoint-1`)).toBe(200);
	});

	test("/runs replays nothing", async () => {
		const dir = history();
		const folder = buildRun(dir, twoSprites);
		const name = folder.split("/").at(-1);
		const url = serve(dir);
		await fetch(`${url}runs`);
		rewriteLines(folder, (lines) => [
			lines[0] as string,
			breakStep(lines[1], "checkpoint-91"),
			...lines.slice(2),
		]);
		const body = (await (await fetch(`${url}${name}/sprites`)).json()) as {
			warnings: string[];
		};
		expect(body.warnings).toEqual([
			expect.stringContaining("Replay stopped at step 91"),
		]);
	});

	test("a failed replay shows its warning on the sprite page", async () => {
		const dir = history();
		const folder = buildRun(dir, (session) => {
			twoSprites(session);
			session.run("layer.create", { spriteId: "sprite-1", name: "a" });
		});
		const name = folder.split("/").at(-1);
		rewriteLines(folder, (lines) => [
			...lines.slice(0, 3),
			breakStep(lines[3], "checkpoint-91"),
		]);
		const url = serve(dir);
		const html = await (await fetch(`${url}${name}/checkpoint-1`)).text();
		expect(html).toContain("Replay stopped at step 91");
		expect(html).toContain("sprite-1, 4x4");
		expect(html).toContain(`"/${name}/checkpoint-1/"`);
	});

	test("a log from another version has the version warning", async () => {
		const dir = history();
		const folder = buildRun(dir, twoSprites);
		const name = folder.split("/").at(-1);
		rewriteLines(folder, (lines) => [
			JSON.stringify({ ...JSON.parse(lines[0] as string), version: "9.9.9" }),
			...lines.slice(1),
		]);
		const url = serve(dir);
		const body = (await (await fetch(`${url}${name}/sprites`)).json()) as {
			warnings: string[];
		};
		expect(body.warnings[0]).toContain("ghosprite 9.9.9");
		expect(body.warnings[0]).toContain(`this is ghosprite ${version}`);
	});

	test("the index is served and a taken port throws EADDRINUSE", async () => {
		const first = startGallery(history(), 0);
		stops.push(first.stop);
		const html = await (await fetch(first.url)).text();
		expect(html).toContain("/runs");
		const port = Number(new URL(first.url).port);
		let code: string | undefined;
		try {
			stops.push(startGallery(history(), port).stop);
		} catch (error) {
			code = (error as { code?: string }).code;
		}
		expect(code).toBe("EADDRINUSE");
	});
});
