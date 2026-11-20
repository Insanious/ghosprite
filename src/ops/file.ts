import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OpError } from "../errors.ts";

export function readFile(path: string): Uint8Array {
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

export function writeFile(
	path: string,
	data: Uint8Array | string,
	field: string,
) {
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, data);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new OpError("invalid_input", message, { path: field });
	}
}
