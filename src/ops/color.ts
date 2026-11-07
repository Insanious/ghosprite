import { z } from "zod";
import type { Rgba } from "../core/image.ts";
import { OpError } from "../errors.ts";

const byte = z.number().int().min(0).max(255);

export const colorSchema = z.union([
	z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
		error: "Expected #rrggbb or #rrggbbaa",
	}),
	z.object({ r: byte, g: byte, b: byte, a: byte.default(255) }),
	z.object({ index: byte }),
]);

export type ColorInput = z.infer<typeof colorSchema>;

export function toRgba(color: ColorInput, path: string): Rgba {
	if (typeof color === "string") {
		const value = (offset: number) =>
			Number.parseInt(color.slice(offset, offset + 2), 16);
		return {
			r: value(1),
			g: value(3),
			b: value(5),
			a: color.length === 9 ? value(7) : 255,
		};
	}
	if ("index" in color) {
		throw new OpError("unsupported", "Indexed colours are not supported yet", {
			path,
			hint: 'Use an RGBA colour such as "#rrggbb" or {r, g, b, a}',
		});
	}
	return color;
}
