import { layerCreate } from "./layer-create.ts";
import type { Operation } from "./registry.ts";
import { spriteCreate } from "./sprite-create.ts";
import { spriteRender } from "./sprite-render.ts";

export const operations: Operation[] = [
	spriteCreate,
	layerCreate,
	spriteRender,
];
