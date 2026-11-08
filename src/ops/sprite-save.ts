import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { z } from "zod";
import { AsepriteFileError } from "../core/ase-bytes.ts";
import { writeAseprite } from "../core/ase-write.ts";
import { OpError } from "../errors.ts";
import { defineOp } from "./registry.ts";

export const spriteSave = defineOp({
	name: "sprite.save",
	description:
		"Write a sprite to an .aseprite file, overwriting any file at path. Changes nothing in the sprite.",
	input: z.object({ spriteId: z.string(), path: z.string() }),
	renderOption: false,
	readOnly: true,
	run: (workspace, input) => {
		const sprite = workspace.getSprite(input.spriteId);
		let bytes: Uint8Array;
		try {
			bytes = writeAseprite(sprite, { deflate: deflateSync });
		} catch (error) {
			if (!(error instanceof AsepriteFileError)) throw error;
			throw new OpError("unsupported", error.message, { path: "spriteId" });
		}
		try {
			writeFileSync(input.path, bytes);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new OpError("invalid_input", message, { path: "path" });
		}
		return {};
	},
});
