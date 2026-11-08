import { celSet } from "./cel-set.ts";
import { drawBezier } from "./draw-bezier.ts";
import { drawLine } from "./draw-line.ts";
import { drawPolygon } from "./draw-polygon.ts";
import { layerCreate } from "./layer-create.ts";
import type { Operation } from "./registry.ts";
import { spriteCreate } from "./sprite-create.ts";
import { spriteLoad } from "./sprite-load.ts";
import { spriteRender } from "./sprite-render.ts";
import { spriteSave } from "./sprite-save.ts";

export const operations: Operation[] = [
	spriteCreate,
	layerCreate,
	celSet,
	drawLine,
	drawBezier,
	drawPolygon,
	spriteRender,
	spriteLoad,
	spriteSave,
];
