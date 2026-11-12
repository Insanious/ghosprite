import { expect } from "bun:test";
import type { CoreErrorCode } from "../../src/core/index.ts";

export function coded(code: CoreErrorCode) {
	return expect.objectContaining({ name: "CoreError", code });
}
