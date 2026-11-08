import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpError } from "./errors.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";

const INSTRUCTIONS =
	"Ids are explicit: creating ops return them, and later calls pass them back. Frames are 0-based. " +
	"Pixel art is authored as rows of legend characters: cel_set replaces a cel with them, and draw_image paints them at x, y over what is there. " +
	"Most ops take `render` to return a picture of their result. sprite_describe shows the structure. " +
	"session_* tools handle batches, undo and checkpoints. Tool names use _ where ops use . (session_apply takes dotted op names).";

export function createMcpServer(session: Session): Server {
	const tools = describeTools(session).map((tool) => ({
		...tool,
		mcpName: tool.name.replaceAll(".", "_"),
	}));
	const dottedNames = new Map(tools.map((t) => [t.mcpName, t.name]));

	const server = new Server(
		{ name: "ghosprite", version: "0.0.0" },
		{ capabilities: { tools: {} }, instructions: INSTRUCTIONS },
	);

	server.setRequestHandler(ListToolsRequestSchema, () => ({
		tools: tools.map((t) => ({
			name: t.mcpName,
			description: t.description,
			inputSchema: t.inputSchema as { type: "object" },
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, (request) => {
		const { name, arguments: input } = request.params;
		try {
			const dotted = dottedNames.get(name);
			if (dotted === undefined) {
				throw new OpError("unknown_op", `Unknown tool "${name}"`);
			}
			const images: Uint8Array[] = [];
			const result = replaceImages(callTool(session, dotted, input), (png) => {
				images.push(png);
				return { key: "image", value: images.length - 1 };
			});
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(result) },
					...images.map((png) => ({
						type: "image" as const,
						data: Buffer.from(png).toString("base64"),
						mimeType: "image/png",
					})),
				],
			};
		} catch (error) {
			const opError =
				error instanceof OpError
					? error
					: new OpError(
							"internal",
							error instanceof Error ? error.message : String(error),
						);
			return {
				isError: true,
				content: [{ type: "text" as const, text: JSON.stringify(opError) }],
			};
		}
	});

	return server;
}

export async function serveStdio(): Promise<void> {
	await createMcpServer(new Session()).connect(new StdioServerTransport());
}
