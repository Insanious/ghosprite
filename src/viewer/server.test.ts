import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "../session.ts";
import { StepPictures } from "./history.ts";
import { startViewer } from "./server.ts";

type Created = { spriteId: string; layerId: string };
type LogItem = {
	kind: string;
	checkpointId: string;
	onPath?: boolean;
	current?: boolean;
};

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function start(port = 0) {
	const pictures = new StepPictures();
	const session = new Session({
		onLog: (entry, workspace) => pictures.record(entry, workspace),
	});
	const viewer = startViewer(session, pictures, port);
	cleanups.push(viewer.stop);
	return { session, pictures, viewer };
}

function paint(session: Session, created: Created, x: number) {
	session.run("draw.rect", {
		...created,
		frame: 0,
		rect: { x, y: 0, width: 1, height: 1 },
		filled: true,
		color: "#ff0000",
	});
}

function create(session: Session) {
	const { spriteId } = session.run("sprite.create", {
		width: 4,
		height: 3,
	}) as unknown as { spriteId: string };
	const { layerId } = session.run("layer.create", {
		spriteId,
		name: "L",
	}) as unknown as { layerId: string };
	return { spriteId, layerId };
}

describe("startViewer", () => {
	test("serves the page at /", async () => {
		const { viewer } = start();
		const response = await fetch(viewer.url);
		expect(response.headers.get("content-type")).toContain("text/html");
		const html = await response.text();
		expect(html).toContain("<html");
		expect(html).toContain('id="main"');
		expect(html).toContain('id="timeline"');
	});

	test("names the run in the heading and title when given one", async () => {
		const pictures = new StepPictures();
		const viewer = startViewer(new Session(), pictures, 0, {
			runName: "2026-01-02T03-04-05Z",
		});
		cleanups.push(viewer.stop);
		const html = await (await fetch(viewer.url)).text();
		expect(html).toContain('<h1 id="run">Run 2026-01-02T03-04-05Z</h1>');
		expect(html).toContain(
			"<title>2026-01-02T03-04-05Z · ghosprite viewer</title>",
		);
	});

	test("has no run heading without a name", async () => {
		const { viewer } = start();
		const html = await (await fetch(viewer.url)).text();
		expect(html).not.toContain('id="run"');
		expect(html).toContain("<title>ghosprite viewer</title>");
	});

	test("escapes the run name", async () => {
		const viewer = startViewer(new Session(), new StepPictures(), 0, {
			runName: '<b>&"x',
		});
		cleanups.push(viewer.stop);
		const html = await (await fetch(viewer.url)).text();
		expect(html).toContain("Run &lt;b&gt;&amp;&quot;x</h1>");
	});

	test("shows warnings escaped in a banner and keeps the run name", async () => {
		const viewer = startViewer(new Session(), new StepPictures(), 0, {
			runName: "r1",
			warnings: ["<b>careful</b>", "second"],
		});
		cleanups.push(viewer.stop);
		const html = await (await fetch(viewer.url)).text();
		expect(html).toContain('id="warnings"');
		expect(html).toContain("<p>&lt;b&gt;careful&lt;/b&gt;</p>");
		expect(html).toContain("<p>second</p>");
		expect(html).not.toContain("<b>careful");
		expect(html).toContain('<h1 id="run">Run r1</h1>');
	});

	test("has no banner without warnings", async () => {
		const { viewer } = start();
		const html = await (await fetch(viewer.url)).text();
		expect(html).not.toContain('id="warnings"');
	});

	test("/log lists steps and moves with the path after an undo and a new step", async () => {
		const { session, viewer } = start();
		const created = create(session);
		paint(session, created, 0);
		session.undo();
		paint(session, created, 1);
		const log = (await (await fetch(`${viewer.url}log`)).json()) as LogItem[];
		expect(log.map((e) => [e.kind, e.checkpointId, e.onPath])).toEqual([
			["step", "checkpoint-1", true],
			["step", "checkpoint-2", true],
			["step", "checkpoint-3", false],
			["moved", "checkpoint-2", undefined],
			["step", "checkpoint-4", true],
		]);
		expect(log.filter((e) => e.current).map((e) => e.checkpointId)).toEqual([
			"checkpoint-4",
		]);
	});

	test("/log marks the step moved to as current after an undo", async () => {
		const { session, viewer } = start();
		const created = create(session);
		paint(session, created, 0);
		session.undo();
		const log = (await (await fetch(`${viewer.url}log`)).json()) as LogItem[];
		const steps = log.filter((e) => e.kind === "step");
		expect(steps.map((e) => [e.checkpointId, e.current])).toEqual([
			["checkpoint-1", false],
			["checkpoint-2", true],
			["checkpoint-3", false],
		]);
	});

	test("/steps/<id>.png serves the stored picture and 404s unknown ids", async () => {
		const { session, pictures, viewer } = start();
		create(session);
		const response = await fetch(`${viewer.url}steps/checkpoint-1.png`);
		expect(response.headers.get("content-type")).toBe("image/png");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(Array.from(body)).toEqual(
			Array.from(pictures.get("checkpoint-1") ?? []),
		);
		const missing = await fetch(`${viewer.url}steps/checkpoint-9.png`);
		expect(missing.status).toBe(404);
	});

	test("other methods get 405 and unknown paths 404, leaving the log alone", async () => {
		const { session, viewer } = start();
		create(session);
		const before = session.stepLog();
		expect((await fetch(viewer.url, { method: "POST" })).status).toBe(405);
		expect((await fetch(`${viewer.url}nope`)).status).toBe(404);
		expect(session.stepLog()).toEqual(before);
	});

	test("moves to the next port when the chosen one is taken", () => {
		const held = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response(""),
		});
		cleanups.push(() => held.stop(true));
		const { viewer } = start(held.port);
		expect(Number(new URL(viewer.url).port)).toBeGreaterThan(
			held.port as number,
		);
	});
});
