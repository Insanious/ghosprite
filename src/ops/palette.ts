import { extname } from "node:path";
import { z } from "zod";
import { CoreError } from "../core/errors.ts";
import type { Rgba } from "../core/image.ts";
import { paletteAt, setPalette } from "../core/palette.ts";
import {
	readGpl,
	readHex,
	readPal,
	writeGpl,
	writeHex,
	writePal,
} from "../core/palette-file.ts";
import { OpError } from "../errors.ts";
import { checkFrame, requireRgba } from "../target.ts";
import { colorSchema, toRgba } from "./color.ts";
import { readFile, writeFile } from "./file.ts";
import { defineOp } from "./registry.ts";

export const MAX_COLORS = 256;

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

export const paletteSet = defineOp({
	name: "palette.set",
	sprite: "edits",
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
		checkFrame(sprite, input.frame);
		const current = paletteAt(sprite.palettes, input.frame);
		setPalette(
			sprite,
			input.frame,
			input.colors.map((color, i) => toRgba(color, `colors.${i}`, current)),
		);
		return {};
	},
});

export const paletteLoad = defineOp({
	name: "palette.load",
	sprite: "edits",
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
		checkFrame(sprite, input.frame);
		const format = formatOf(input.path);
		const text = new TextDecoder().decode(readFile(input.path));
		let colors: Rgba[];
		try {
			colors = format.read(text);
		} catch (error) {
			if (!(error instanceof CoreError)) throw error;
			throw new OpError(error.code, error.message, {
				path: "path",
				hint: error.hint,
			});
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
	sprite: "reads",
	description:
		"Write the palette in effect at a frame to a .gpl, .hex or .pal file, overwriting any file at path. The format comes from the file extension. Changes nothing in the sprite.",
	input: z.object({
		spriteId: z.string(),
		path: z.string(),
		frame: z.number().int().min(0).default(0),
	}),
	renderOption: false,
	run(workspace, input) {
		const sprite = workspace.getSprite(input.spriteId);
		checkFrame(sprite, input.frame);
		const format = formatOf(input.path);
		const { colors } = paletteAt(sprite.palettes, input.frame);
		writeFile(input.path, format.write(colors), "path");
		return {};
	},
});
