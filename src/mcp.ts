import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpError, toOpError } from "./errors.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";

const INSTRUCTIONS =
	"Ids are explicit: creating ops return them, and later calls pass them back. Frames are 0-based. " +
	"Pixel art is authored as rows of legend characters: cel_set replaces a cel with them, and draw_image paints them at x, y over what is there. " +
	"Author a figure as short blocks of rows, one per part such as head, torso and legs, each painted with draw_image at its own x, y: short rows are easier to count, a selected part moves with region_move, the `symmetry` draw option mirrors a front-facing part, cel_get reads a cel back as rows to edit, and draw_pixels touches single pixels. " +
	"Combine tools for what none does alone: for a shape at an angle, draw it axis-aligned, select it and turn it with region_rotate; for a soft edge, stack shrinking filled shapes in a translucent colour, which builds up where they overlap. " +
	"Most ops take `render` to return a picture of their result. sprite_describe shows the structure. " +
	"Pass a short `note` on every change saying what it is for, and a `label` on session_apply. " +
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
			const opError = toOpError(error);
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
