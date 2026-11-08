import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { decodePng } from "../src/core/png.ts";
import { createMcpServer } from "../src/mcp.ts";
import { Session } from "../src/session.ts";

async function connect() {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await createMcpServer(new Session()).connect(serverTransport);
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
		for (const name of ["sprite_create", "session_apply"]) {
			const tool = tools.find((t) => t.name === name);
			expect(tool?.inputSchema.type).toBe("object");
		}
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
