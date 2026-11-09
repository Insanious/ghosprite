import { basename } from "node:path";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import { encodePng } from "../core/png.ts";
import { layoutSheet } from "../core/sheet.ts";
import { buildSheetJson } from "../core/sheet-json.ts";
import { OpError } from "../errors.ts";
import { requireRgba } from "../target.ts";
import { writeFile } from "./file.ts";
import { defineOp } from "./registry.ts";

const supportedToken =
	/^\{(?:name|title|extension|tag|duration|(?:frame|tagframe)\d*)\}$/;

const count = z.number().int().positive();
const padding = z.number().int().min(0).default(0);

export const spriteExportSheet = defineOp({
	name: "sprite.exportSheet",
	description:
		"Export a sprite as a sprite sheet PNG at path with Aseprite-style JSON data at dataPath, overwriting any files there. Changes nothing in the sprite.",
	input: z
		.object({
			spriteId: z.string(),
			path: z.string(),
			dataPath: z.string(),
			type: z
				.enum(["horizontal", "vertical", "rows", "columns"])
				.default("rows"),
			columns: count.optional().describe("Frames per row, for type rows."),
			rows: count.optional().describe("Frames per column, for type columns."),
			tag: z.string().optional().describe("Export only this tag's frames."),
			trim: z.boolean().default(false),
			trimSprite: z.boolean().default(false),
			ignoreEmpty: z.boolean().default(false),
			extrude: z.boolean().default(false),
			borderPadding: padding,
			shapePadding: padding,
			innerPadding: padding,
			dataFormat: z.enum(["hash", "array"]).default("hash"),
			filenameFormat: z
				.string()
				.superRefine((format, ctx) => {
					const bad = format
						.match(/\{[^{}]*\}/g)
						?.find((token) => !supportedToken.test(token));
					if (bad !== undefined) {
						ctx.addIssue({
							code: "custom",
							message: `Unsupported filename token ${bad}`,
						});
					}
				})
				.optional()
				.describe(
					"Frame names in the JSON, with the tokens {name} {title} {extension} {frame} {tagframe} {tag} {duration} and padded or offset forms such as {frame001}. Any other {token} is rejected.",
				),
			name: z
				.string()
				.default("sprite.aseprite")
				.describe(
					"The sprite's file name, for {name}, {title} and {extension}.",
				),
		})
		.refine((o) => o.columns === undefined || o.type === "rows", {
			path: ["columns"],
			message: "columns needs type rows",
		})
		.refine((o) => o.rows === undefined || o.type === "columns", {
			path: ["rows"],
			message: "rows needs type columns",
		}),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		if (
			input.tag !== undefined &&
			!sprite.tags.some((t) => t.name === input.tag)
		) {
			throw new OpError("not_found", `No tag named "${input.tag}"`, {
				path: "tag",
			});
		}
		const sheet = layoutSheet(sprite, input);
		const json = buildSheetJson(sprite, sheet, {
			...input,
			image: basename(input.path),
		});
		const png = encodePng(sheet.texture, deflateSync);
		writeFile(input.path, png, "path");
		writeFile(input.dataPath, JSON.stringify(json, null, 1), "dataPath");
		return {};
	},
});
