import { ByteWriter, type FrameChunks, writeChunk } from "./ase-bytes.ts";
import {
	collectExtensionIds,
	writeExternalFilesChunk,
	writeSlices,
	writeTags,
	writeUserData,
} from "./ase-write-meta.ts";
import { CoreError } from "./errors.ts";
import type { Rgba } from "./image.ts";
import type { Palette } from "./palette.ts";
import { paletteAt } from "./palette.ts";
import type { ZlibFn } from "./png.ts";
import {
	BLEND_MODES,
	type Cel,
	type ColorProfile,
	framesSharingData,
	type ImageLayer,
	type Layer,
	type Sprite,
} from "./sprite.ts";

const FILE_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const HEADER_SIZE = 128;
const FRAME_HEADER_SIZE = 16;

const FLAG_LAYER_OPACITY = 1;
const FLAG_COMPOSE_GROUPS = 2;
const FLAG_LAYER_UUIDS = 4;

const CHUNK_OLD_PALETTE_8BIT = 0x0004;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_CEL_EXTRA = 0x2006;
const CHUNK_COLOR_PROFILE = 0x2007;
const CHUNK_PALETTE = 0x2019;

const DEPTHS = { rgba: 32, grayscale: 16, indexed: 8 };
const COLOR_PROFILE_TYPES = { none: 0, srgb: 1, icc: 2 };
const COLOR_PROFILE_HAS_GAMMA = 1;
const CEL_EXTRA_PRECISE_BOUNDS = 1;
const FIXED_ONE = 65536;

const LAYER_IMAGE = 0;
const LAYER_GROUP = 1;
const CEL_LINKED = 1;
const CEL_COMPRESSED = 2;

export type WriteAsepriteOptions = { deflate: ZlibFn };

/** What every chunk writer of the file needs. */
type WriteState = {
	writer: ByteWriter;
	sprite: Sprite;
	deflate: ZlibFn;
	flags: number;
	/** Whether every palette chunk is the `0x2019` kind. */
	newPaletteChunks: boolean;
	extensionIds: Map<string, number>;
	/** Every layer in layer-chunk order, which is how cels refer to them. */
	layers: { layer: Layer; level: number }[];
};

export function writeAseprite(
	sprite: Sprite,
	options: WriteAsepriteOptions,
): Uint8Array {
	const writer = new ByteWriter();
	const layers = flattenLayers(sprite);
	const state: WriteState = {
		writer,
		sprite,
		deflate: options.deflate,
		flags: headerFlags(sprite, layers),
		newPaletteChunks: needsNewPaletteChunks(sprite),
		extensionIds: collectExtensionIds(sprite, layers),
		layers,
	};
	writeHeader(state);
	for (let frame = 0; frame < sprite.frameDurations.length; frame++) {
		writeFrame(state, frame);
	}
	writer.patchDword(0, writer.position);
	return writer.toBytes();
}

/** The format can't hold an empty palette (a count of 0 means 256), so it becomes one black entry. */
function writablePaletteAt(sprite: Sprite, frame: number): Palette {
	const palette = paletteAt(sprite.palettes, frame);
	if (palette.colors.length > 0) return palette;
	return { ...palette, colors: [{ r: 0, g: 0, b: 0, a: 255 }] };
}

function headerFlags(sprite: Sprite, layers: WriteState["layers"]): number {
	const withUuid = layers.filter(
		({ layer }) => layer.uuid !== undefined,
	).length;
	if (withUuid !== 0 && withUuid !== layers.length) {
		throw new CoreError(
			"unsupported",
			"Either every layer has a UUID or none does",
		);
	}
	return (
		FLAG_LAYER_OPACITY |
		(sprite.composeGroups ? FLAG_COMPOSE_GROUPS : 0) |
		(withUuid > 0 ? FLAG_LAYER_UUIDS : 0)
	);
}

function needsNewPaletteChunks(sprite: Sprite): boolean {
	return sprite.palettes.some(
		(palette) =>
			palette.colors.length > 256 || palette.colors.some((c) => c.a < 255),
	);
}

/** Layer chunk order: bottom first, each group followed by its children. */
function flattenLayers(sprite: Sprite): WriteState["layers"] {
	const layers: WriteState["layers"] = [];
	const visit = (parent: Layer[], level: number) => {
		for (const layer of parent) {
			layers.push({ layer, level });
			if (layer.kind === "group") visit(layer.children, level + 1);
		}
	};
	visit(sprite.root.children, 0);
	return layers;
}

function writeHeader({ writer, sprite, flags }: WriteState): void {
	writer.dword(0);
	writer.word(FILE_MAGIC);
	writer.word(sprite.frameDurations.length);
	writer.word(sprite.width);
	writer.word(sprite.height);
	writer.word(DEPTHS[sprite.mode]);
	writer.dword(flags);
	writer.word(sprite.frameDurations[0] ?? 0);
	writer.write(new Uint8Array(8));
	writer.byte(sprite.transparentIndex);
	writer.write(new Uint8Array(3));
	writer.word(writablePaletteAt(sprite, 0).colors.length);
	writer.byte(sprite.pixelRatio.width);
	writer.byte(sprite.pixelRatio.height);
	writer.short(sprite.gridBounds.x);
	writer.short(sprite.gridBounds.y);
	writer.word(sprite.gridBounds.width);
	writer.word(sprite.gridBounds.height);
	writer.write(new Uint8Array(HEADER_SIZE - writer.position));
}

function writeFrame(state: WriteState, frame: number): void {
	const { writer, sprite } = state;
	const start = writer.position;
	const chunks: FrameChunks = { count: 0 };
	writer.write(new Uint8Array(FRAME_HEADER_SIZE));

	if (frame === 0) {
		writeExternalFilesChunk(state, chunks);
		writeColorProfile(state, chunks);
	}
	writePaletteIfChanged(state, chunks, frame);
	if (frame === 0) {
		writeUserData(state, chunks, sprite.userData);
		writeTags(state, chunks);
		writeLayerChunks(state, chunks);
		writeSlices(state, chunks);
	}
	writeCels(state, chunks, frame);

	const oldCount = Math.min(chunks.count, 0xffff);
	const duration = sprite.frameDurations[frame] ?? 0;
	writer.patchDword(start, writer.position - start);
	writer.patchDword(start + 4, FRAME_MAGIC | (oldCount << 16));
	writer.patchDword(start + 8, duration);
	writer.patchDword(start + 12, chunks.count);
}

function writeColorProfile(state: WriteState, chunks: FrameChunks): void {
	const { writer, sprite } = state;
	const profile: ColorProfile = sprite.colorProfile;
	writeChunk(writer, chunks, CHUNK_COLOR_PROFILE, () => {
		writer.word(COLOR_PROFILE_TYPES[profile.type]);
		writer.word(profile.fixedGamma !== undefined ? COLOR_PROFILE_HAS_GAMMA : 0);
		writer.fixed(Math.round((profile.fixedGamma ?? 0) * FIXED_ONE));
		writer.write(new Uint8Array(8));
		if (profile.type === "icc") {
			writer.dword(profile.icc.length);
			writer.write(profile.icc);
		}
	});
}

/** The range of entries that differ, as Aseprite's `Palette::countDiff` finds it. */
function changedRange(
	previous: Palette,
	palette: Palette,
): { from: number; to: number } | undefined {
	const shared = Math.min(previous.colors.length, palette.colors.length);
	let from = -1;
	let to = -1;
	for (let i = 0; i < shared; i++) {
		if (!sameColor(previous.colors[i], palette.colors[i])) {
			if (from < 0) from = i;
			to = i;
		}
	}
	if (previous.colors.length !== palette.colors.length) {
		if (from < 0) from = shared;
		to = Math.max(previous.colors.length, palette.colors.length) - 1;
	}
	return from < 0 ? undefined : { from, to };
}

function sameColor(a: Rgba | undefined, b: Rgba | undefined): boolean {
	return (
		a !== undefined &&
		b !== undefined &&
		a.r === b.r &&
		a.g === b.g &&
		a.b === b.b &&
		a.a === b.a
	);
}

function writePaletteIfChanged(
	state: WriteState,
	chunks: FrameChunks,
	frame: number,
): void {
	const palette = writablePaletteAt(state.sprite, frame);
	let range: { from: number; to: number } | undefined = {
		from: 0,
		to: palette.colors.length - 1,
	};
	if (frame > 0) {
		range = changedRange(writablePaletteAt(state.sprite, frame - 1), palette);
	}
	if (!range) return;
	if (state.newPaletteChunks) {
		writePaletteChunk(state, chunks, palette, range.from, range.to);
	} else {
		writeOldPaletteChunk(state, chunks, palette);
	}
}

function writePaletteChunk(
	{ writer }: WriteState,
	chunks: FrameChunks,
	palette: Palette,
	from: number,
	to: number,
): void {
	// A shrunk palette has no entries past its new size to write.
	const last = Math.min(to, palette.colors.length - 1);
	writeChunk(writer, chunks, CHUNK_PALETTE, () => {
		writer.dword(palette.colors.length);
		writer.dword(from);
		writer.dword(last);
		writer.write(new Uint8Array(8));
		for (let i = from; i <= last; i++) {
			const { r, g, b, a } = palette.colors[i] as Rgba;
			writer.word(0);
			writer.byte(r);
			writer.byte(g);
			writer.byte(b);
			writer.byte(a);
		}
	});
}

function writeOldPaletteChunk(
	{ writer }: WriteState,
	chunks: FrameChunks,
	palette: Palette,
): void {
	writeChunk(writer, chunks, CHUNK_OLD_PALETTE_8BIT, () => {
		writer.word(1);
		writer.byte(0);
		writer.byte(palette.colors.length === 256 ? 0 : palette.colors.length);
		for (const { r, g, b } of palette.colors) {
			writer.byte(r);
			writer.byte(g);
			writer.byte(b);
		}
	});
}

function writeLayerChunks(state: WriteState, chunks: FrameChunks): void {
	for (const { layer, level } of state.layers) {
		writeLayerChunk(state, chunks, layer, level);
		writeUserData(state, chunks, layer.userData);
	}
}

function layerFlagBits(layer: Layer): number {
	const { flags } = layer;
	return (
		(flags.visible ? 1 : 0) |
		(flags.editable ? 2 : 0) |
		(flags.lockMove ? 4 : 0) |
		(flags.background ? 8 : 0) |
		(flags.continuous ? 16 : 0) |
		(flags.collapsed ? 32 : 0) |
		(flags.reference ? 64 : 0)
	);
}

function writeLayerChunk(
	{ writer, sprite, flags }: WriteState,
	chunks: FrameChunks,
	layer: Layer,
	level: number,
): void {
	const hasBlendInfo = layer.kind === "image" || sprite.composeGroups;
	writeChunk(writer, chunks, CHUNK_LAYER, () => {
		writer.word(layerFlagBits(layer));
		writer.word(layer.kind === "group" ? LAYER_GROUP : LAYER_IMAGE);
		writer.word(level);
		writer.word(0);
		writer.word(0);
		writer.word(hasBlendInfo ? BLEND_MODES.indexOf(layer.blendMode) : 0);
		writer.byte(hasBlendInfo ? layer.opacity : 0);
		writer.write(new Uint8Array(3));
		writer.string(layer.name);
		if (flags & FLAG_LAYER_UUIDS) writer.uuid(layer.uuid as string);
	});
}

function writeCels(
	state: WriteState,
	chunks: FrameChunks,
	frame: number,
): void {
	state.layers.forEach(({ layer }, layerIndex) => {
		if (layer.kind !== "image") return;
		const cel = layer.cels.get(frame);
		if (cel) writeCel(state, chunks, layer, layerIndex, cel);
	});
}

function writeCel(
	state: WriteState,
	chunks: FrameChunks,
	layer: ImageLayer,
	layerIndex: number,
	cel: Cel,
): void {
	const { writer } = state;
	const { data } = cel;
	const firstFrame = framesSharingData(layer, data)[0] as number;
	const isLink = firstFrame < cel.frame;
	writeChunk(writer, chunks, CHUNK_CEL, () => {
		writer.word(layerIndex);
		writer.short(data.x);
		writer.short(data.y);
		writer.byte(data.opacity);
		writer.word(isLink ? CEL_LINKED : CEL_COMPRESSED);
		writer.short(cel.zIndex);
		writer.write(new Uint8Array(5));
		if (isLink) {
			writer.word(firstFrame);
			return;
		}
		writer.word(data.image.width);
		writer.word(data.image.height);
		writer.write(state.deflate(data.image.data));
	});
	if (isLink) return;
	if (data.preciseBounds) writeCelExtraChunk(state, chunks, cel);
	writeUserData(state, chunks, data.userData);
}

function writeCelExtraChunk(
	{ writer }: WriteState,
	chunks: FrameChunks,
	cel: Cel,
): void {
	const bounds = cel.data.preciseBounds;
	if (!bounds) return;
	writeChunk(writer, chunks, CHUNK_CEL_EXTRA, () => {
		writer.dword(CEL_EXTRA_PRECISE_BOUNDS);
		writer.fixed(Math.round(bounds.x * FIXED_ONE));
		writer.fixed(Math.round(bounds.y * FIXED_ONE));
		writer.fixed(Math.round(bounds.width * FIXED_ONE));
		writer.fixed(Math.round(bounds.height * FIXED_ONE));
		writer.write(new Uint8Array(16));
	});
}
