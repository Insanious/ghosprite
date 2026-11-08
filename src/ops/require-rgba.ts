import type { Sprite } from "../core/sprite.ts";
import { OpError } from "../errors.ts";

export function requireRgba(sprite: Sprite): void {
	if (sprite.mode !== "rgba") {
		throw new OpError("unsupported", `Cannot edit a ${sprite.mode} sprite`, {
			hint: "Only RGBA sprites are supported",
		});
	}
}
