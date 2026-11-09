import { z } from "zod";

export const pointSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
});

export const rectSchema = z.object({
	x: z.number().int(),
	y: z.number().int(),
	width: z.number().int().min(1),
	height: z.number().int().min(1),
});
