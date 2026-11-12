import { writeFileSync } from "node:fs";
import { z } from "zod";
import type { Sprite } from "./core/index.ts";
import { createImage, diffFrames, renderFrame } from "./core/index.ts";
import { OpError } from "./errors.ts";
import { parseInput } from "./ops/registry.ts";
import { renderOptionFields, withGridRule } from "./ops/render.ts";
import { renderPng } from "./ops/render-output.ts";
import type { Session } from "./session.ts";

export type Tool = {
	name: string;
	description: string;
	schema: z.ZodObject;
	run: (session: Session, input: never) => unknown;
};

export type ToolDescription = {
	name: string;
	description: string;
	inputSchema: unknown;
};

function defineTool<S extends z.ZodObject>(tool: {
	name: string;
	description: string;
	schema: S;
	run: (session: Session, input: z.output<S>) => unknown;
}): Tool {
	return tool;
}

function renderSide(sprite: Sprite, frame: number) {
	return frame < sprite.frameDurations.length
		? renderFrame(sprite, frame)
		: createImage(sprite.width, sprite.height, "rgba");
}

const steps = z.number().int().min(1).optional();

export const sessionTools: Tool[] = [
	defineTool({
		name: "session.apply",
		description:
			"Run several operations as one atomic transaction and one undo step. If any fails, nothing changes. Ops keep their dotted names, for example sprite.create.",
		schema: z.object({
			label: z.string().optional(),
			ops: z.array(z.object({ op: z.string(), input: z.unknown() })).min(1),
		}),
		run: (session, input) => session.apply(input.ops, input.label),
	}),
	defineTool({
		name: "session.undo",
		description: "Undo the last steps of the workspace history.",
		schema: z.object({ steps }),
		run: (session, input) => session.undo(input.steps),
	}),
	defineTool({
		name: "session.redo",
		description: "Redo steps that were undone.",
		schema: z.object({ steps }),
		run: (session, input) => session.redo(input.steps),
	}),
	defineTool({
		name: "session.checkpoint",
		description:
			"Name the current state so it can be restored or compared later. Returns its checkpointId.",
		schema: z.object({ name: z.string().min(1) }),
		run: (session, input) => session.checkpoint(input.name),
	}),
	defineTool({
		name: "session.restore",
		description:
			"Move the workspace to a checkpoint, given by id or name, by undoing or redoing steps.",
		schema: z.object({ checkpoint: z.string() }),
		run: (session, input) => session.restore(input.checkpoint),
	}),
	defineTool({
		name: "session.journal",
		description:
			"Return the calls that rebuild the current state, as a script for ghosprite run. With path, also write the script there as JSON.",
		schema: z.object({ path: z.string().optional() }),
		run: (session, input) => {
			const journal = session.journal();
			if (input.path !== undefined) {
				writeFileSync(input.path, JSON.stringify(journal, null, 2));
			}
			return input.path === undefined
				? { journal }
				: { journal, path: input.path };
		},
	}),
	defineTool({
		name: "sprite.diff",
		description:
			"Compare a sprite at a checkpoint with another checkpoint or the live sprite. Returns one PNG per frame with before, after and changed pixels side by side, plus the changed pixel count and bounds. Uses every frame that exists on either side unless frames is given. Changes nothing.",
		schema: withGridRule(
			z.object({
				spriteId: z.string(),
				from: z.string().describe("Checkpoint id or name."),
				to: z
					.string()
					.optional()
					.describe("Checkpoint id or name. Defaults to the live sprite."),
				...renderOptionFields,
			}),
		),
		run: (session, input) => {
			const before = session.spriteAt(input.from, input.spriteId);
			const after =
				input.to === undefined
					? session.workspace.getSprite(input.spriteId)
					: session.spriteAt(input.to, input.spriteId);
			const frameCount = Math.max(
				before.frameDurations.length,
				after.frameDurations.length,
			);
			const frames =
				input.frames ?? Array.from({ length: frameCount }, (_, i) => i);
			if (frames.some((frame) => frame >= frameCount)) {
				throw new OpError(
					"out_of_range",
					`A frame is out of range, the sprites have ${frameCount} frames at most`,
					{ path: "frames" },
				);
			}
			return {
				frames: frames.map((frame) => {
					const diff = diffFrames(
						renderSide(before, frame),
						renderSide(after, frame),
					);
					return {
						frame,
						png: renderPng(
							[diff.before, diff.after, diff.changes],
							input,
							{ columns: 3, gap: 1 },
							"scale",
						).png,
						changedPixels: diff.changedPixels,
						bounds: diff.bounds,
					};
				}),
			};
		},
	}),
];

export function callTool(
	session: Session,
	name: string,
	input: unknown,
): unknown {
	const tool = sessionTools.find((t) => t.name === name);
	if (!tool) return session.run(name, input);
	return tool.run(session, parseInput(tool.schema, input) as never);
}

export function describeTools(session: Session): ToolDescription[] {
	return [
		...session.registry.describeOps(),
		...sessionTools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: z.toJSONSchema(tool.schema, { io: "input" }),
		})),
	];
}

export type ImagePath = (string | number)[];

export function replaceImages(
	result: unknown,
	replace: (
		png: Uint8Array,
		path: ImagePath,
	) => { key: string; value: unknown },
): unknown {
	const walk = (value: unknown, path: ImagePath): unknown => {
		if (Array.isArray(value)) {
			return value.map((item, index) => walk(item, [...path, index]));
		}
		if (typeof value !== "object" || value === null) return value;
		if (value instanceof Uint8Array) return value;
		const copy: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			if (key === "png" && item instanceof Uint8Array) {
				const replacement = replace(item, path);
				copy[replacement.key] = replacement.value;
			} else {
				copy[key] = walk(item, [...path, key]);
			}
		}
		return copy;
	};
	return walk(result, []);
}
