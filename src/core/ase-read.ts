import { AsepriteFileError, ByteReader } from "./ase-bytes.ts";
import {
	bytesPerPixel,
	type ColorMode,
	copyImage,
	createImage,
	type Image,
} from "./image.ts";
import type { Palette } from "./palette.ts";
import { paletteAt } from "./palette.ts";
import type { ZlibFn } from "./png.ts";
import {
	addLayer,
	BLEND_MODES,
	type CelData,
	createGroupLayer,
	createImageLayer,
	createSprite,
	type GroupLayer,
	type ImageLayer,
	type Layer,
	type LayerFlags,
	type Sprite,
	setCel,
} from "./sprite.ts";
import { createUserData } from "./user-data.ts";

const FILE_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const HEADER_SIZE = 128;
const CHUNK_HEADER_SIZE = 6;
const MAX_PALETTE_SIZE = 1 << 20;

const FLAG_LAYER_OPACITY = 1;
const FLAG_COMPOSE_GROUPS = 2;
const FLAG_LAYER_UUIDS = 4;

const CHUNK_OLD_PALETTE_6BIT = 0x000b;
const CHUNK_OLD_PALETTE_8BIT = 0x0004;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_PALETTE = 0x2019;
const CHUNK_TILESET = 0x2023;

const LAYER_IMAGE = 0;
const LAYER_GROUP = 1;
const LAYER_TILEMAP = 2;

const CEL_RAW = 0;
const CEL_LINKED = 1;
const CEL_COMPRESSED = 2;
const CEL_TILEMAP = 3;

const COLOR_MODES: Record<number, ColorMode> = {
	32: "rgba",
	16: "grayscale",
	8: "indexed",
};

export type ReadAsepriteOptions = {
	inflate: ZlibFn;
	/** Supplies model IDs, since the file has none. */
	newLayerId: () => string;
};

export type ReadAsepriteResult = { sprite: Sprite; warnings: string[] };

type Header = {
	frames: number;
	flags: number;
	hasLayerOpacity: boolean;
	hasLayerUuids: boolean;
};

/** Everything the chunk handlers share while the frames are read. */
type ReadState = {
	reader: ByteReader;
	options: ReadAsepriteOptions;
	header: Header;
	sprite: Sprite;
	warnings: string[];
	frame: number;
	/** One entry per layer chunk, in file order. */
	layers: Layer[];
	/** `groupStack[n]` is the group that holds layers at child level `n`. */
	groupStack: GroupLayer[];
	hasBackground: boolean;
	sawNewPalette: boolean;
};

export function readAseprite(
	bytes: Uint8Array,
	options: ReadAsepriteOptions,
): ReadAsepriteResult {
	const reader = new ByteReader(bytes);
	const { header, sprite } = readHeader(reader);
	const state: ReadState = {
		reader,
		options,
		header,
		sprite,
		warnings: [],
		frame: 0,
		layers: [],
		groupStack: [sprite.root],
		hasBackground: false,
		sawNewPalette: false,
	};
	for (let frame = 0; frame < header.frames; frame++) {
		state.frame = frame;
		readFrame(state);
	}
	return { sprite, warnings: state.warnings };
}

function readHeader(reader: ByteReader): { header: Header; sprite: Sprite } {
	reader.dword();
	if (reader.word() !== FILE_MAGIC) {
		throw new AsepriteFileError("malformed", "Not an Aseprite file");
	}
	const frames = reader.word();
	const width = reader.word();
	const height = reader.word();
	const depth = reader.word();
	const flags = reader.dword();
	const speed = reader.word();
	reader.skip(8);
	const transparentByte = reader.byte();
	reader.skip(3);
	const colorCount = reader.word() || 256;
	const pixelWidth = reader.byte();
	const pixelHeight = reader.byte();
	const gridBounds = {
		x: reader.short(),
		y: reader.short(),
		width: reader.word(),
		height: reader.word(),
	};
	reader.seek(HEADER_SIZE);

	const mode = COLOR_MODES[depth];
	if (!mode) {
		throw new AsepriteFileError("malformed", `Unknown color depth ${depth}`);
	}
	if (frames < 1) {
		throw new AsepriteFileError("malformed", "The file has no frames");
	}

	const sprite = createSprite({
		width,
		height,
		mode,
		palettes: [{ startFrame: 0, colors: blackPalette(colorCount) }],
		transparentIndex: mode === "indexed" ? transparentByte : 0,
		frameDurations: new Array<number>(frames).fill(speed),
	});
	sprite.composeGroups = (flags & FLAG_COMPOSE_GROUPS) !== 0;
	if (pixelWidth > 0 && pixelHeight > 0) {
		sprite.pixelRatio = { width: pixelWidth, height: pixelHeight };
	}
	sprite.gridBounds = gridBounds;

	return {
		header: {
			frames,
			flags,
			hasLayerOpacity: (flags & FLAG_LAYER_OPACITY) !== 0,
			hasLayerUuids: (flags & FLAG_LAYER_UUIDS) !== 0,
		},
		sprite,
	};
}

function readFrame(state: ReadState): void {
	const { reader, sprite } = state;
	reader.dword();
	if (reader.word() !== FRAME_MAGIC) {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} has a bad magic number`,
		);
	}
	const oldChunkCount = reader.word();
	const duration = reader.word();
	reader.skip(2);
	const newChunkCount = reader.dword();
	const chunkCount = oldChunkCount === 0xffff ? newChunkCount : oldChunkCount;
	if (duration > 0) sprite.frameDurations[state.frame] = duration;

	for (let i = 0; i < chunkCount; i++) {
		const start = reader.position;
		const size = reader.dword();
		const type = reader.word();
		if (size < CHUNK_HEADER_SIZE) {
			throw new AsepriteFileError(
				"malformed",
				`Chunk at ${start} is ${size} bytes, smaller than its header`,
			);
		}
		const end = start + size;
		if (end > reader.length) {
			throw new AsepriteFileError(
				"malformed",
				`Chunk at ${start} runs past the end of the file`,
			);
		}
		readChunk(state, type, end);
		reader.seek(end);
	}
}

/** Chunks this switch doesn't name are skipped. */
function readChunk(state: ReadState, type: number, end: number): void {
	switch (type) {
		case CHUNK_OLD_PALETTE_6BIT:
		case CHUNK_OLD_PALETTE_8BIT:
			if (!state.sawNewPalette) readOldPaletteChunk(state, type);
			break;
		case CHUNK_PALETTE:
			readPaletteChunk(state);
			state.sawNewPalette = true;
			break;
		case CHUNK_LAYER:
			readLayerChunk(state);
			break;
		case CHUNK_CEL:
			readCelChunk(state, end);
			break;
		case CHUNK_TILESET:
			throw new AsepriteFileError("unsupported", "Tilesets are not supported");
	}
}

function blackPalette(size: number): Palette["colors"] {
	return Array.from({ length: size }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
}

function palettesDiffer(a: Palette, b: Palette): boolean {
	if (a.colors.length !== b.colors.length) return true;
	return a.colors.some((color, i) => {
		const other = b.colors[i];
		return (
			other === undefined ||
			color.r !== other.r ||
			color.g !== other.g ||
			color.b !== other.b ||
			color.a !== other.a
		);
	});
}

function startPalette(state: ReadState): Palette {
	const previous = paletteAt(state.sprite.palettes, state.frame);
	return {
		startFrame: state.frame,
		colors: previous.colors.map((color) => ({ ...color })),
	};
}

function setPaletteEntry(
	palette: Palette,
	index: number,
	color: { r: number; g: number; b: number; a: number },
): void {
	if (index >= MAX_PALETTE_SIZE) {
		throw new AsepriteFileError(
			"malformed",
			`Palette entry ${index} is out of range`,
		);
	}
	while (palette.colors.length <= index) {
		palette.colors.push({ r: 0, g: 0, b: 0, a: 255 });
	}
	palette.colors[index] = color;
}

function commitPalette(state: ReadState, palette: Palette): void {
	const previous = paletteAt(state.sprite.palettes, state.frame);
	if (!palettesDiffer(previous, palette)) return;
	const { palettes } = state.sprite;
	const sameFrame = palettes.findIndex((p) => p.startFrame === state.frame);
	if (sameFrame >= 0) palettes[sameFrame] = palette;
	else palettes.push(palette);
	palettes.sort((a, b) => a.startFrame - b.startFrame);
}

function readPaletteChunk(state: ReadState): void {
	const { reader } = state;
	const palette = startPalette(state);
	const newSize = reader.dword();
	const from = reader.dword();
	const to = reader.dword();
	reader.skip(8);
	if (newSize > MAX_PALETTE_SIZE) {
		throw new AsepriteFileError(
			"malformed",
			`Palette size ${newSize} is out of range`,
		);
	}
	if (newSize > 0) {
		palette.colors.length = Math.min(palette.colors.length, newSize);
		while (palette.colors.length < newSize) {
			palette.colors.push({ r: 0, g: 0, b: 0, a: 255 });
		}
	}
	for (let index = from; index <= to; index++) {
		const hasName = (reader.word() & 1) !== 0;
		const r = reader.byte();
		const g = reader.byte();
		const b = reader.byte();
		const a = reader.byte();
		setPaletteEntry(palette, index, { r, g, b, a });
		if (hasName) reader.string();
	}
	commitPalette(state, palette);
}

function readOldPaletteChunk(state: ReadState, type: number): void {
	const { reader } = state;
	const palette = startPalette(state);
	const scale =
		type === CHUNK_OLD_PALETTE_6BIT
			? (value: number) => (value << 2) | (value >> 4)
			: (value: number) => value;
	const packets = reader.word();
	let index = 0;
	for (let i = 0; i < packets; i++) {
		index += reader.byte();
		const count = reader.byte() || 256;
		for (const end = index + count; index < end; index++) {
			const r = scale(reader.byte());
			const g = scale(reader.byte());
			const b = scale(reader.byte());
			setPaletteEntry(palette, index, { r, g, b, a: 255 });
		}
	}
	commitPalette(state, palette);
}

function layerFlags(bits: number): LayerFlags {
	return {
		visible: (bits & 1) !== 0,
		editable: (bits & 2) !== 0,
		lockMove: (bits & 4) !== 0,
		background: (bits & 8) !== 0,
		continuous: (bits & 16) !== 0,
		collapsed: (bits & 32) !== 0,
		reference: (bits & 64) !== 0,
	};
}

function readLayerChunk(state: ReadState): void {
	const { reader, header, sprite } = state;
	const flagBits = reader.word();
	const layerType = reader.word();
	const childLevel = reader.word();
	reader.skip(4);
	const blendIndex = reader.word();
	const storedOpacity = reader.byte();
	reader.skip(3);
	const name = reader.string();

	if (layerType === LAYER_TILEMAP) {
		throw new AsepriteFileError(
			"unsupported",
			"Tilemap layers are not supported",
		);
	}
	if (layerType !== LAYER_IMAGE && layerType !== LAYER_GROUP) {
		throw new AsepriteFileError(
			"unsupported",
			`Unknown layer type ${layerType}`,
		);
	}
	const uuid = header.hasLayerUuids ? reader.uuid() : undefined;

	const blendMode = BLEND_MODES[blendIndex];
	if (!blendMode) {
		throw new AsepriteFileError(
			"unsupported",
			`Unknown blend mode ${blendIndex}`,
		);
	}
	if (childLevel >= state.groupStack.length) {
		throw new AsepriteFileError(
			"malformed",
			`Layer "${name}" is nested ${childLevel} levels deep under a layer that is not a group`,
		);
	}
	state.groupStack.length = childLevel + 1;
	const parent = state.groupStack[childLevel] as GroupLayer;

	const flags = layerFlags(flagBits);
	const isBackground = flags.background;
	if (isBackground) {
		const reason = backgroundProblem(state, layerType, parent);
		if (reason) {
			flags.background = false;
			state.warnings.push(
				`Layer "${name}" is marked as background but ${reason}, so the flag was cleared`,
			);
		} else {
			state.hasBackground = true;
		}
	}

	const hasBlendAndOpacity =
		!isBackground && (layerType === LAYER_IMAGE || sprite.composeGroups);
	const init = {
		id: state.options.newLayerId(),
		...(uuid !== undefined && { uuid }),
		name,
		flags,
		...(hasBlendAndOpacity && {
			blendMode,
			opacity: header.hasLayerOpacity ? storedOpacity : 255,
		}),
	};
	const layer =
		layerType === LAYER_GROUP ? createGroupLayer(init) : createImageLayer(init);
	addLayer(sprite, layer, parent);
	state.layers.push(layer);
	if (layer.kind === "group") state.groupStack.push(layer);
}

function backgroundProblem(
	state: ReadState,
	layerType: number,
	parent: GroupLayer,
): string | undefined {
	if (layerType === LAYER_GROUP) return "is a group";
	if (state.hasBackground) return "the sprite already has a background layer";
	if (parent !== state.sprite.root || parent.children.length > 0) {
		return "it is not the bottom layer of the root";
	}
	return undefined;
}

function readCelChunk(state: ReadState, end: number): void {
	const { reader, sprite } = state;
	const layerIndex = reader.word();
	const x = reader.short();
	const y = reader.short();
	const opacity = reader.byte();
	const celType = reader.word();
	const zIndex = reader.short();
	reader.skip(5);

	const layer = state.layers[layerIndex];
	if (!layer) {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} has a cel on layer ${layerIndex}, which does not exist`,
		);
	}
	if (layer.kind !== "image") {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} has a cel on layer ${layerIndex}, which is a group`,
		);
	}

	if (celType === CEL_LINKED) {
		readLinkedCel(state, layer, { x, y, opacity, zIndex });
		return;
	}
	if (celType === CEL_TILEMAP) {
		throw new AsepriteFileError(
			"unsupported",
			"Tilemap cels are not supported",
		);
	}
	if (celType !== CEL_RAW && celType !== CEL_COMPRESSED) {
		throw new AsepriteFileError("unsupported", `Unknown cel type ${celType}`);
	}

	const width = reader.word();
	const height = reader.word();
	if (width === 0 || height === 0) return;
	const image = createImage(width, height, sprite.mode);
	const pixels =
		celType === CEL_RAW
			? reader.read(image.data.length)
			: inflatePixels(state, image, reader.read(end - reader.position));
	image.data.set(pixels);
	setCel(
		sprite,
		layer,
		state.frame,
		{ image, x, y, opacity, userData: createUserData() },
		zIndex,
	);
}

function inflatePixels(
	state: ReadState,
	image: Image,
	compressed: Uint8Array,
): Uint8Array {
	let pixels: Uint8Array;
	try {
		pixels = state.options.inflate(compressed);
	} catch (error) {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} has cel pixel data that does not decompress: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const expected = image.width * image.height * bytesPerPixel(image.mode);
	if (pixels.length !== expected) {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} has ${pixels.length} bytes of cel pixel data, expected ${expected}`,
		);
	}
	return pixels;
}

function readLinkedCel(
	state: ReadState,
	layer: ImageLayer,
	placement: { x: number; y: number; opacity: number; zIndex: number },
): void {
	const linkFrame = state.reader.word();
	const target = layer.cels.get(linkFrame);
	if (!target) {
		throw new AsepriteFileError(
			"malformed",
			`Frame ${state.frame} links to frame ${linkFrame}, which has no cel on the layer`,
		);
	}
	const { x, y, opacity, zIndex } = placement;
	const shared = target.data;
	const data: CelData =
		shared.x === x && shared.y === y && shared.opacity === opacity
			? shared
			: {
					image: copyImage(shared.image),
					x,
					y,
					opacity,
					userData: createUserData(),
				};
	setCel(state.sprite, layer, state.frame, data, zIndex);
}
