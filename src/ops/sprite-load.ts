import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { z } from "zod";
import { AsepriteFileError } from "../core/ase-bytes.ts";
import { readAseprite } from "../core/ase-read.ts";
import { OpError } from "../errors.ts";
import { defineOp } from "./registry.ts";

function readFile(path: string): Uint8Array {
	try {
		return readFileSync(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		throw new OpError(missing ? "not_found" : "invalid_input", message, {
			path: "path",
		});
	}
}

export const spriteLoad = defineOp({
	name: "sprite.load",
	description:
		"Load an .aseprite file into a new sprite. Returns its spriteId and warnings about data that was dropped.",
	input: z.object({ path: z.string() }),
	run: (workspace, input) => {
		const bytes = readFile(input.path);
		try {
			const { sprite, warnings } = readAseprite(bytes, {
				inflate: inflateSync,
				newLayerId: () => workspace.nextId("layer"),
			});
			return { spriteId: workspace.addSprite(sprite), warnings };
		} catch (error) {
			if (!(error instanceof AsepriteFileError)) throw error;
			if (error.reason === "unsupported") {
				throw new OpError("unsupported", error.message, {
					path: "path",
					hint: "Tilemaps aren't supported yet",
				});
			}
			throw new OpError("invalid_input", error.message, { path: "path" });
		}
	},
});
