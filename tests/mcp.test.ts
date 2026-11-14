import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodePng } from "../src/core/index.ts";
import { createMcpServer } from "../src/mcp.ts";
import { startRunLog } from "../src/run-log.ts";
import { Session } from "../src/session.ts";
import { startGallery } from "../src/viewer/gallery.ts";

const viewer = { url: "http://127.0.0.1:7357/", run: "run-a" };

async function connect(
	viewerLinks?: { url: string; run: string },
	session = new Session(),
) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await createMcpServer(session, viewerLinks).connect(serverTransport);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(clientTransport);
	return client;
}

type Block = { type: string; text?: string; data?: string };

function textOf(content: unknown) {
	const block = (content as Block[])[0];
	return JSON.parse(block?.text ?? "null");
}

describe("mcp server", () => {
	test("lists tools with object input schemas", async () => {
		const { tools } = await (await connect()).listTools();
		for (const name of ["sprite_create", "session_apply", "session_resume"]) {
			const tool = tools.find((t) => t.name === name);
			expect(tool?.inputSchema.type).toBe("object");
		}
	});

	test("the instructions name the gallery only when given a viewer", async () => {
		const withViewer = (await connect(viewer)).getInstructions();
		expect(withViewer).toContain(viewer.url);
		expect(withViewer).toContain("ghosprite view");
		const without = (await connect()).getInstructions();
		expect(without).not.toContain("http");
		expect(without).not.toContain("ghosprite view");
	});

	test("sprite_create and sprite_load results carry a viewer link", async () => {
		const client = await connect(viewer);
		const created = await client.callTool({
			name: "sprite_create",
			arguments: { width: 2, height: 2 },
		});
		expect(textOf(created.content).viewer).toBe(
			`${viewer.url}${viewer.run}/checkpoint-1`,
		);
		const loaded = await client.callTool({
			name: "sprite_load",
			arguments: { path: "tests/fixtures/doc/base.aseprite" },
		});
		expect(textOf(loaded.content).viewer).toBe(
			`${viewer.url}${viewer.run}/checkpoint-2`,
		);
	});

	test("session_apply links only the sprite.create and sprite.load entries", async () => {
		const client = await connect(viewer);
		const response = await client.callTool({
			name: "session_apply",
			arguments: {
				ops: [
					{ op: "sprite.create", input: { width: 2, height: 2 } },
					{ op: "layer.create", input: { spriteId: "sprite-1" } },
				],
			},
		});
		const { results } = textOf(response.content);
		expect(results[0].viewer).toBe(`${viewer.url}${viewer.run}/checkpoint-1`);
		expect(results[1]).not.toHaveProperty("viewer");
	});

	test("a failed create has no link, and without a viewer no result has one", async () => {
		const failed = await (await connect(viewer)).callTool({
			name: "sprite_create",
			arguments: { width: 0, height: 2 },
		});
		expect(failed.isError).toBe(true);
		expect(JSON.stringify(textOf(failed.content))).not.toContain("viewer");
		const plain = await (await connect()).callTool({
			name: "sprite_create",
			arguments: { width: 2, height: 2 },
		});
		expect(textOf(plain.content)).not.toHaveProperty("viewer");
	});

	test("the links open the sprites' pages in the gallery", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ghosprite-mcp-links-"));
		const gallery = startGallery(dir, 0);
		try {
			const runLog = startRunLog(dir);
			const client = await connect(
				{ url: gallery.url, run: runLog.name },
				new Session({ onLog: (entry) => runLog.append(entry) }),
			);
			const first = textOf(
				(
					await client.callTool({
						name: "sprite_create",
						arguments: { width: 2, height: 2 },
					})
				).content,
			);
			const second = textOf(
				(
					await client.callTool({
						name: "session_apply",
						arguments: {
							ops: [{ op: "sprite.create", input: { width: 3, height: 3 } }],
						},
					})
				).content,
			);
			const links = [
				[first.viewer, "sprite-1,"],
				[second.results[0].viewer, "sprite-2,"],
			];
			for (const [link, heading] of links) {
				const response = await fetch(
					new URL(new URL(link).pathname, gallery.url),
				);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toContain("text/html");
				expect(await response.text()).toMatch(
					new RegExp(`<h1[^>]*>\\s*${heading}`),
				);
			}
		} finally {
			gallery.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("every tool the instructions name exists", async () => {
		const client = await connect(viewer);
		const { tools } = await client.listTools();
		const names = new Set(tools.map((t) => t.name));
		const mentioned = client.getInstructions()?.match(/\b[a-z]+_[a-zA-Z]+\b/g);
		expect(mentioned).toContain("cel_set");
		expect(mentioned).toContain("draw_image");
		expect(mentioned).toContain("region_rotate");
		expect(mentioned).toContain("region_move");
		for (const name of mentioned ?? []) expect(names).toContain(name);
	});

	test("a render call returns text JSON plus a PNG image block", async () => {
		const client = await connect();
		await client.callTool({
			name: "sprite_create",
			arguments: { width: 4, height: 3 },
		});
		await client.callTool({
			name: "layer_create",
			arguments: { spriteId: "sprite-1" },
		});
		const response = await client.callTool({
			name: "draw_rect",
			arguments: {
				spriteId: "sprite-1",
				layerId: "layer-1",
				frame: 0,
				color: "#ff0000",
				rect: { x: 0, y: 0, width: 2, height: 2 },
				render: { scale: 2 },
			},
		});
		expect(response.isError).toBeFalsy();
		const content = response.content as Block[];
		expect(content).toHaveLength(2);
		expect(JSON.stringify(textOf(content))).toContain('"image":0');
		expect(content[1]?.type).toBe("image");
		const png = decodePng(
			new Uint8Array(Buffer.from(content[1]?.data ?? "", "base64")),
			inflateSync,
		);
		expect([png.width, png.height]).toEqual([8, 6]);
	});

	test("a bad spriteId is a not_found error", async () => {
		const response = await (await connect()).callTool({
			name: "layer_create",
			arguments: { spriteId: "nope" },
		});
		expect(response.isError).toBe(true);
		expect(textOf(response.content).code).toBe("not_found");
	});

	test("session_undo after a draw works", async () => {
		const client = await connect();
		await client.callTool({
			name: "sprite_create",
			arguments: { width: 2, height: 2 },
		});
		await client.callTool({
			name: "layer_create",
			arguments: { spriteId: "sprite-1" },
		});
		await client.callTool({
			name: "draw_rect",
			arguments: {
				spriteId: "sprite-1",
				layerId: "layer-1",
				frame: 0,
				color: "#ff0000",
				rect: { x: 0, y: 0, width: 1, height: 1 },
			},
		});
		const response = await client.callTool({
			name: "session_undo",
			arguments: {},
		});
		expect(response.isError).toBeFalsy();
	});
});
