import { celDelete } from "./cel-delete.ts";
import { celLink } from "./cel-link.ts";
import { celSet } from "./cel-set.ts";
import { celUnlink } from "./cel-unlink.ts";
import { drawBezier } from "./draw-bezier.ts";
import { drawEllipse } from "./draw-ellipse.ts";
import { drawFill } from "./draw-fill.ts";
import { drawLine } from "./draw-line.ts";
import { drawPolygon } from "./draw-polygon.ts";
import { drawRect } from "./draw-rect.ts";
import { drawSpray } from "./draw-spray.ts";
import { filterBrightnessContrast } from "./filter-brightness-contrast.ts";
import { filterColorCurve } from "./filter-color-curve.ts";
import { filterConvolution } from "./filter-convolution.ts";
import { filterDespeckle } from "./filter-despeckle.ts";
import { filterHueSaturation } from "./filter-hue-saturation.ts";
import { filterInvert } from "./filter-invert.ts";
import { filterOutline } from "./filter-outline.ts";
import { filterReplaceColor } from "./filter-replace-color.ts";
import { frameCreate } from "./frame-create.ts";
import { frameDelete } from "./frame-delete.ts";
import { frameDuplicate } from "./frame-duplicate.ts";
import { layerCreate } from "./layer-create.ts";
import { layerDelete } from "./layer-delete.ts";
import { layerMergeDown } from "./layer-merge-down.ts";
import { paletteLoad, paletteSave, paletteSet } from "./palette.ts";
import { paletteQuantize } from "./palette-quantize.ts";
import type { Operation } from "./registry.ts";
import { selectionCombine } from "./selection-combine.ts";
import { selectionCreate } from "./selection-create.ts";
import { selectionDelete } from "./selection-delete.ts";
import { selectionInvert } from "./selection-invert.ts";
import { selectionModify } from "./selection-modify.ts";
import { sliceCreate } from "./slice-create.ts";
import { sliceDelete } from "./slice-delete.ts";
import { spriteContactSheet } from "./sprite-contact-sheet.ts";
import { spriteCreate } from "./sprite-create.ts";
import { spriteCrop } from "./sprite-crop.ts";
import { spriteDescribe } from "./sprite-describe.ts";
import { spriteExport } from "./sprite-export.ts";
import { spriteExportSheet } from "./sprite-export-sheet.ts";
import { spriteFlatten } from "./sprite-flatten.ts";
import { spriteFlip } from "./sprite-flip.ts";
import { spriteLoad } from "./sprite-load.ts";
import { spriteMapToPalette } from "./sprite-map-to-palette.ts";
import { spriteRender } from "./sprite-render.ts";
import { spriteResize } from "./sprite-resize.ts";
import { spriteRotate } from "./sprite-rotate.ts";
import { spriteSave } from "./sprite-save.ts";
import { spriteTrim } from "./sprite-trim.ts";
import { tagCreate } from "./tag-create.ts";
import { tagDelete } from "./tag-delete.ts";

export const operations: Operation[] = [
	spriteCreate,
	layerCreate,
	layerDelete,
	layerMergeDown,
	spriteFlatten,
	celSet,
	celDelete,
	celLink,
	celUnlink,
	frameCreate,
	frameDuplicate,
	frameDelete,
	drawLine,
	drawBezier,
	drawPolygon,
	drawRect,
	drawEllipse,
	drawFill,
	drawSpray,
	spriteRotate,
	spriteFlip,
	spriteRender,
	spriteContactSheet,
	spriteLoad,
	spriteResize,
	spriteSave,
	spriteExport,
	spriteExportSheet,
	tagCreate,
	tagDelete,
	sliceCreate,
	sliceDelete,
	spriteCrop,
	spriteTrim,
	spriteDescribe,
	selectionCreate,
	selectionCombine,
	selectionDelete,
	selectionInvert,
	selectionModify,
	spriteMapToPalette,
	paletteSet,
	paletteLoad,
	paletteSave,
	paletteQuantize,
	filterInvert,
	filterReplaceColor,
	filterColorCurve,
	filterBrightnessContrast,
	filterHueSaturation,
	filterOutline,
	filterConvolution,
	filterDespeckle,
];
