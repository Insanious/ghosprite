import { deflateSync } from "node:zlib";
import { z } from "zod";
import { AsepriteFileError } from "../core/ase-bytes.ts";
import { writeAseprite } from "../core/ase-write.ts";
import { OpError } from "../errors.ts";
import { writeFile } from "./file.ts";
import { defineOp } from "./registry.ts";

export const spriteSave = defineOp({
	name: "sprite.save",
	sprite: "reads",
	description:
		"Write a sprite to an .aseprite file, overwriting any file at path. Changes nothing in the sprite.",
	input: z.object({ spriteId: z.string(), path: z.string() }),
	renderOption: false,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		let bytes: Uint8Array;
		try {
			bytes = writeAseprite(sprite, { deflate: deflateSync });
		} catch (error) {
			if (!(error instanceof AsepriteFileError)) throw error;
			throw new OpError("unsupported", error.message, { path: "spriteId" });
		}
		writeFile(input.path, bytes, "path");
		return {};
	},
});
