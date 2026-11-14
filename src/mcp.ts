import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { OpError, toOpError } from "./errors.ts";
import { type RunLog, startRunLog, writePidFile } from "./run-log.ts";
import { resumeTool } from "./run-resume.ts";
import { Session } from "./session.ts";
import { callTool, describeTools, replaceImages } from "./tools.ts";
import { StepPictures } from "./viewer/history.ts";
import { startViewer } from "./viewer/server.ts";

const INSTRUCTIONS =
	"Ids are explicit: creating ops return them, and later calls pass them back. Frames are 0-based. " +
	"Pixel art is authored as rows of legend characters: cel_set replaces a cel with them, and draw_image paints them at x, y over what is there. " +
	"Author a figure as short blocks of rows, one per part such as head, torso and legs, each painted with draw_image at its own x, y: short rows are easier to count, a selected part moves with region_move, the `symmetry` draw option mirrors a front-facing part, cel_get reads a cel back as rows to edit, and draw_pixels touches single pixels. " +
	"Combine tools for what none does alone: for a shape at an angle, draw it axis-aligned, select it and turn it with region_rotate; for a soft edge, stack shrinking filled shapes in a translucent colour, which builds up where they overlap. " +
	"Most ops take `render` to return a picture of their result. sprite_describe shows the structure. " +
	"Pass a short `note` on every change saying what it is for, and a `label` on session_apply. " +
	"session_* tools handle batches, undo and checkpoints. Tool names use _ where ops use . (session_apply takes dotted op names).";

type Viewer = { url: string; run: string };

const LINKED_OPS = new Set(["sprite.create", "sprite.load"]);

function viewerSentence(url: string): string {
	return `A read-only gallery of your sprites is at ${url}. sprite_create and sprite_load return a \`viewer\` link to that sprite's page: give it to the user whenever you create or load a sprite. If the page doesn't open, tell the user to run \`ghosprite view\`.`;
}

function withViewerLinks(
	viewer: Viewer,
	name: string,
	input: unknown,
	result: unknown,
): unknown {
	if (!LINKED_OPS.has(name) && name !== "session.apply") return result;
	const { checkpointId } = result as { checkpointId: string };
	const link = { viewer: `${viewer.url}${viewer.run}/${checkpointId}` };
	if (LINKED_OPS.has(name)) return { ...(result as object), ...link };
	const { ops } = input as { ops: { op: string }[] };
	const { results } = result as { results: object[] };
	return {
		...(result as object),
		results: results.map((entry, index) =>
			LINKED_OPS.has(ops[index]?.op ?? "") ? { ...entry, ...link } : entry,
		),
	};
}

export function createMcpServer(
	session: Session,
	viewer?: Viewer,
	history?: { dir: string; log: RunLog },
): Server {
	const extraTools = [resumeTool(history)];
	const tools = describeTools(session, extraTools).map((tool) => ({
		...tool,
		mcpName: tool.name.replaceAll(".", "_"),
	}));
	const dottedNames = new Map(tools.map((t) => [t.mcpName, t.name]));

	const server = new Server(
		{ name: "ghosprite", version: "0.0.0" },
		{
			capabilities: { tools: {} },
			instructions:
				viewer === undefined
					? INSTRUCTIONS
					: `${INSTRUCTIONS} ${viewerSentence(viewer.url)}`,
		},
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
			const called = callTool(session, dotted, input, extraTools);
			const result = replaceImages(
				viewer === undefined
					? called
					: withViewerLinks(viewer, dotted, input, called),
				(png) => {
					images.push(png);
					return { key: "image", value: images.length - 1 };
				},
			);
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

export async function serveStdio(
	options: { viewerPort?: number; historyDir?: string } = {},
): Promise<void> {
	const { viewerPort, historyDir } = options;
	const runLog = historyDir === undefined ? undefined : startRunLog(historyDir);
	if (runLog !== undefined) {
		const removePidFile = writePidFile(runLog.folder);
		process.stdin.once("end", removePidFile);
		process.once("exit", removePidFile);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			process.once(signal, () => {
				removePidFile();
				process.exit();
			});
		}
	}
	const pictures = new StepPictures();
	const session = new Session({
		onLog: (entry, workspace) => {
			if (viewerPort !== undefined) pictures.record(entry, workspace);
			runLog?.append(entry);
		},
	});
	const viewer =
		viewerPort === undefined
			? undefined
			: startViewer(session, pictures, viewerPort, { runName: runLog?.name });
	if (viewer !== undefined) process.stdin.once("end", viewer.stop);
	const history =
		historyDir === undefined || runLog === undefined
			? undefined
			: { dir: historyDir, log: runLog };
	await createMcpServer(
		session,
		viewer !== undefined && runLog !== undefined
			? { url: viewer.url, run: runLog.name }
			: undefined,
		history,
	).connect(new StdioServerTransport());
}
