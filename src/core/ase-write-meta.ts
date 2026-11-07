import { type ByteWriter, type FrameChunks, writeChunk } from "./ase-bytes.ts";
import { writePropertiesMaps } from "./ase-properties.ts";
import type { Layer, Sprite } from "./sprite.ts";
import { TAG_DIRECTIONS } from "./tag.ts";
import type { UserData } from "./user-data.ts";

const CHUNK_EXTERNAL_FILES = 0x2008;
const CHUNK_TAGS = 0x2018;
const CHUNK_USER_DATA = 0x2020;
const CHUNK_SLICE = 0x2022;

const EXTERNAL_FILE_EXTENSION = 2;
const USER_DATA_HAS_TEXT = 1;
const USER_DATA_HAS_COLOR = 2;
const USER_DATA_HAS_PROPERTIES = 4;
const SLICE_HAS_CENTER = 1;
const SLICE_HAS_PIVOT = 2;

/** What the metadata chunk writers need from the writer's state. */
export type MetaState = {
	writer: ByteWriter;
	sprite: Sprite;
	/** Extension name to the ID the external files chunk gives it. */
	extensionIds: Map<string, number>;
};

/** Gives every extension named by a properties map an ID, counting up from 1 in order of first use. */
export function collectExtensionIds(
	sprite: Sprite,
	layers: { layer: Layer }[],
): Map<string, number> {
	const ids = new Map<string, number>();
	const collect = (userData: UserData) => {
		for (const [name, map] of userData.properties) {
			if (name !== "" && map.size > 0 && !ids.has(name)) {
				ids.set(name, ids.size + 1);
			}
		}
	};
	collect(sprite.userData);
	for (const tag of sprite.tags) collect(tag.userData);
	for (const { layer } of layers) {
		collect(layer.userData);
		if (layer.kind === "image") {
			for (const cel of layer.cels.values()) collect(cel.data.userData);
		}
	}
	for (const slice of sprite.slices) collect(slice.userData);
	return ids;
}

export function writeExternalFilesChunk(
	{ writer, extensionIds }: MetaState,
	chunks: FrameChunks,
): void {
	if (extensionIds.size === 0) return;
	writeChunk(writer, chunks, CHUNK_EXTERNAL_FILES, () => {
		writer.dword(extensionIds.size);
		writer.write(new Uint8Array(8));
		for (const [name, id] of extensionIds) {
			writer.dword(id);
			writer.byte(EXTERNAL_FILE_EXTENSION);
			writer.write(new Uint8Array(7));
			writer.string(name);
		}
	});
}

function isEmpty(userData: UserData): boolean {
	return (
		userData.text === "" &&
		userData.color.a === 0 &&
		[...userData.properties.values()].every((map) => map.size === 0)
	);
}

function writeUserDataChunk(
	{ writer, extensionIds }: MetaState,
	chunks: FrameChunks,
	userData: UserData,
): void {
	const hasProperties = [...userData.properties.values()].some(
		(map) => map.size > 0,
	);
	const { color } = userData;
	writeChunk(writer, chunks, CHUNK_USER_DATA, () => {
		writer.dword(
			(userData.text !== "" ? USER_DATA_HAS_TEXT : 0) |
				(color.a !== 0 ? USER_DATA_HAS_COLOR : 0) |
				(hasProperties ? USER_DATA_HAS_PROPERTIES : 0),
		);
		if (userData.text !== "") writer.string(userData.text);
		if (color.a !== 0) {
			writer.byte(color.r);
			writer.byte(color.g);
			writer.byte(color.b);
			writer.byte(color.a);
		}
		if (hasProperties) {
			writePropertiesMaps(writer, userData.properties, (name) =>
				extensionIds.get(name),
			);
		}
	});
}

/** Writes the chunk only when the user data holds something. */
export function writeUserData(
	state: MetaState,
	chunks: FrameChunks,
	userData: UserData,
): void {
	if (!isEmpty(userData)) writeUserDataChunk(state, chunks, userData);
}

/** The tags chunk, then one user data chunk per tag even when empty, so the reader's binding stays aligned. */
export function writeTags(state: MetaState, chunks: FrameChunks): void {
	const { writer, sprite } = state;
	if (sprite.tags.length === 0) return;
	writeChunk(writer, chunks, CHUNK_TAGS, () => {
		writer.word(sprite.tags.length);
		writer.write(new Uint8Array(8));
		for (const tag of sprite.tags) {
			writer.word(tag.from);
			writer.word(tag.to);
			writer.byte(TAG_DIRECTIONS.indexOf(tag.direction));
			writer.word(tag.repeat);
			writer.write(new Uint8Array(6));
			writer.byte(tag.userData.color.r);
			writer.byte(tag.userData.color.g);
			writer.byte(tag.userData.color.b);
			writer.byte(0);
			writer.string(tag.name);
		}
	});
	for (const tag of sprite.tags)
		writeUserDataChunk(state, chunks, tag.userData);
}

export function writeSlices(state: MetaState, chunks: FrameChunks): void {
	const { writer } = state;
	for (const slice of state.sprite.slices) {
		const hasCenter = slice.keys.some((key) => key.center !== undefined);
		const hasPivot = slice.keys.some((key) => key.pivot !== undefined);
		writeChunk(writer, chunks, CHUNK_SLICE, () => {
			writer.dword(slice.keys.length);
			writer.dword(
				(hasCenter ? SLICE_HAS_CENTER : 0) | (hasPivot ? SLICE_HAS_PIVOT : 0),
			);
			writer.dword(0);
			writer.string(slice.name);
			for (const key of slice.keys) {
				writer.dword(key.frame);
				writer.rect(key.bounds);
				if (hasCenter) {
					writer.rect(key.center ?? { x: 0, y: 0, width: 0, height: 0 });
				}
				if (hasPivot) writer.point(key.pivot ?? { x: 0, y: 0 });
			}
		});
		writeUserData(state, chunks, slice.userData);
	}
}
