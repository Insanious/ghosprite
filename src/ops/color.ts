import { z } from "zod";
import type { Palette, Rgba } from "../core/index.ts";
import { OpError } from "../errors.ts";

const byte = z.number().int().min(0).max(255);

export const literalColorSchema = z.union([
	z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
		error: "Expected #rrggbb or #rrggbbaa",
	}),
	z.object({ r: byte, g: byte, b: byte, a: byte.default(255) }),
]);

export const colorSchema = z
	.union([...literalColorSchema.options, z.object({ index: byte })])
	.describe(
		"#rrggbb, #rrggbbaa, {r, g, b, a} or {index}. An index picks that entry of the palette in effect at the frame the operation works on (frame 0 when it has none), so it fails if the palette is shorter.",
	);

export type ColorInput = z.infer<typeof colorSchema>;

export function toRgba(
	color: ColorInput,
	path: string,
	palette: Palette,
): Rgba {
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
		const entry = palette.colors[color.index];
		if (!entry) {
			throw new OpError(
				"out_of_range",
				`Palette index ${color.index} does not exist`,
				{
					path,
					hint: `The palette has ${palette.colors.length} colours, numbered from 0`,
				},
			);
		}
		return { ...entry };
	}
	return color;
}
