import type { ByteReader } from "./ase-bytes.ts";
import { readPropertiesMaps } from "./ase-properties.ts";
import type { Rect } from "./image.ts";
import type { Slice, SliceKey } from "./slice.ts";
import type { ColorProfile } from "./sprite.ts";
import { TAG_DIRECTIONS, type Tag } from "./tag.ts";
import { createUserData, type UserData } from "./user-data.ts";

const USER_DATA_HAS_TEXT = 1;
const USER_DATA_HAS_COLOR = 2;
const USER_DATA_HAS_PROPERTIES = 4;

const SLICE_HAS_CENTER = 1;
const SLICE_HAS_PIVOT = 2;

const COLOR_PROFILE_NONE = 0;
const COLOR_PROFILE_SRGB = 1;
const COLOR_PROFILE_ICC = 2;
const COLOR_PROFILE_HAS_GAMMA = 1;

const CEL_EXTRA_PRECISE_BOUNDS = 1;

/** Extension ID to the file name that the external files chunk gives it. */
export type ExternalFiles = Map<number, string>;

const FIXED_ONE = 65536;

export function readExternalFilesChunk(
	reader: ByteReader,
	files: ExternalFiles,
): void {
	const count = reader.dword();
	reader.skip(8);
	for (let i = 0; i < count; i++) {
		const id = reader.dword();
		reader.skip(8);
		files.set(id, reader.string());
	}
}

/** Tags get the deprecated colour bytes as their colour until a user data chunk replaces it. */
export function readTagsChunk(reader: ByteReader, end: number): Tag[] {
	const count = reader.word();
	reader.skip(8);
	const tags: Tag[] = [];
	for (let i = 0; i < count && reader.position < end; i++) {
		const from = reader.word();
		const to = reader.word();
		const direction = TAG_DIRECTIONS[reader.byte()] ?? "forward";
		const repeat = reader.word();
		reader.skip(6);
		const r = reader.byte();
		const g = reader.byte();
		const b = reader.byte();
		reader.skip(1);
		const name = reader.string();
		const userData = createUserData();
		userData.color = { r, g, b, a: 255 };
		tags.push({ name, from, to, direction, repeat, userData });
	}
	return tags;
}

export function readSliceChunk(reader: ByteReader, end: number): Slice {
	const keyCount = reader.dword();
	const flags = reader.dword();
	reader.skip(4);
	const name = reader.string();
	const keys: SliceKey[] = [];
	for (let i = 0; i < keyCount && reader.position < end; i++) {
		const frame = reader.dword();
		const key: SliceKey = { frame, bounds: reader.rect() };
		if (flags & SLICE_HAS_CENTER) key.center = reader.rect();
		if (flags & SLICE_HAS_PIVOT) key.pivot = reader.point();
		keys.push(key);
	}
	return { name, userData: createUserData(), keys };
}

export function readUserDataChunk(
	reader: ByteReader,
	externalFiles: ExternalFiles,
): UserData {
	const flags = reader.dword();
	const userData = createUserData();
	if (flags & USER_DATA_HAS_TEXT) userData.text = reader.string();
	if (flags & USER_DATA_HAS_COLOR) {
		userData.color = {
			r: reader.byte(),
			g: reader.byte(),
			b: reader.byte(),
			a: reader.byte(),
		};
	}
	if (flags & USER_DATA_HAS_PROPERTIES) {
		userData.properties = readPropertiesMaps(reader, (id) =>
			externalFiles.get(id),
		);
	}
	return userData;
}

/** Returns undefined for a profile type this reader doesn't know. */
export function readColorProfileChunk(
	reader: ByteReader,
): ColorProfile | undefined {
	const type = reader.word();
	const flags = reader.word();
	const gamma = reader.fixed();
	reader.skip(8);
	const fixedGamma =
		flags & COLOR_PROFILE_HAS_GAMMA
			? { fixedGamma: gamma / FIXED_ONE }
			: undefined;
	switch (type) {
		case COLOR_PROFILE_NONE:
			return { type: "none", ...fixedGamma };
		case COLOR_PROFILE_SRGB:
			return { type: "srgb", ...fixedGamma };
		case COLOR_PROFILE_ICC:
			return {
				type: "icc",
				icc: reader.read(reader.dword()).slice(),
				...fixedGamma,
			};
		default:
			return undefined;
	}
}

/** Returns undefined when the bounds are empty, as Aseprite does. */
export function readCelExtraChunk(reader: ByteReader): Rect | undefined {
	const flags = reader.dword();
	if (!(flags & CEL_EXTRA_PRECISE_BOUNDS)) return undefined;
	const x = reader.fixed() / FIXED_ONE;
	const y = reader.fixed() / FIXED_ONE;
	const width = reader.fixed() / FIXED_ONE;
	const height = reader.fixed() / FIXED_ONE;
	if (width === 0 || height === 0) return undefined;
	return { x, y, width, height };
}
