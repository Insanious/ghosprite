import { extname } from "node:path";
import { z } from "zod";
import type { Rgba } from "../core/image.ts";
import { paletteAt } from "../core/palette.ts";
import {
	readGpl,
	readHex,
	readPal,
	writeGpl,
	writeHex,
	writePal,
} from "../core/palette-file.ts";
import type { Sprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";
import { colorSchema, toRgba } from "./color.ts";
import { readFile, writeFile } from "./file.ts";
import { checkExistingFrame } from "./frame-changed.ts";
import { defineOp } from "./registry.ts";
import { requireRgba } from "./require-rgba.ts";

const MAX_COLORS = 256;

const FORMATS = {
	".gpl": { read: readGpl, write: writeGpl },
	".hex": { read: readHex, write: writeHex },
	".pal": { read: readPal, write: writePal },
};

function formatOf(path: string) {
	const extension = extname(path).toLowerCase();
	if (!Object.hasOwn(FORMATS, extension)) {
		throw new OpError("invalid_input", `Unknown palette file type "${path}"`, {
			path: "path",
			hint: "Use a .gpl, .hex or .pal file",
		});
	}
	return FORMATS[extension as keyof typeof FORMATS];
}

function setPalette(sprite: Sprite, frame: number, colors: Rgba[]) {
	const existing = sprite.palettes.find((p) => p.startFrame === frame);
	if (existing) {
		existing.colors = colors;
		return;
	}
	sprite.palettes.push({ startFrame: frame, colors });
	sprite.palettes.sort((a, b) => a.startFrame - b.startFrame);
}

export const paletteSet = defineOp({
	name: "palette.set",
	description:
		"Set the palette that starts at a frame, adding one if none starts there. It applies from that frame until the next palette. Palettes that start at other frames are kept. In an RGBA sprite a palette changes no pixels.",
	input: z.object({
		spriteId: z.string(),
		frame: z.number().int().min(0).default(0),
		colors: z.array(colorSchema).min(1).max(MAX_COLORS),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		checkExistingFrame(sprite, input.frame);
		setPalette(
			sprite,
			input.frame,
			input.colors.map((color, i) => toRgba(color, `colors.${i}`)),
		);
		return {};
	},
});

export const paletteLoad = defineOp({
	name: "palette.load",
	description:
		"Read a .gpl, .hex or .pal palette file and set its colours as palette.set does. The format comes from the file extension.",
	input: z.object({
		spriteId: z.string(),
		path: z.string(),
		frame: z.number().int().min(0).default(0),
	}),
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		requireRgba(sprite);
		checkExistingFrame(sprite, input.frame);
		const format = formatOf(input.path);
		const text = new TextDecoder().decode(readFile(input.path));
		let colors: Rgba[];
		try {
			colors = format.read(text);
		} catch (error) {
			if (!(error instanceof RangeError)) throw error;
			throw new OpError("invalid_input", error.message, { path: "path" });
		}
		if (colors.length === 0 || colors.length > MAX_COLORS) {
			throw new OpError(
				"invalid_input",
				`The file has ${colors.length} colours`,
				{ path: "path", hint: `A palette holds 1 to ${MAX_COLORS} colours` },
			);
		}
		setPalette(sprite, input.frame, colors);
		return {};
	},
});

export const paletteSave = defineOp({
	name: "palette.save",
	description:
		"Write the palette in effect at a frame to a .gpl, .hex or .pal file, overwriting any file at path. The format comes from the file extension. Changes nothing in the sprite.",
	input: z.object({
		spriteId: z.string(),
		path: z.string(),
		frame: z.number().int().min(0).default(0),
	}),
	renderOption: false,
	readOnly: true,
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		checkExistingFrame(sprite, input.frame);
		const format = formatOf(input.path);
		const { colors } = paletteAt(sprite.palettes, input.frame);
		writeFile(input.path, format.write(colors), "path");
		return {};
	},
});
