import { CoreError } from "./errors.ts";
import type { Image, Rgba } from "./image.ts";

const CHILDREN = 16;

type Channels = readonly [r: number, g: number, b: number, a: number];

function hextet([r, g, b, a]: Channels, level: number): number {
	const bit = 0x80 >> level;
	return (
		(r & bit ? 1 : 0) |
		(g & bit ? 2 : 0) |
		(b & bit ? 4 : 0) |
		(a & bit ? 8 : 0)
	);
}

/** Palette.findBestfit: weighted distance on the top five bits of each channel. */
function findBestfit(
	palette: readonly Rgba[],
	r: number,
	g: number,
	b: number,
	a: number,
	maskIndex: number,
): number {
	const r5 = r >> 3;
	const g5 = g >> 3;
	const b5 = b >> 3;
	const a5 = a >> 3;
	if (a5 === 0 && maskIndex >= 0) return maskIndex;
	let bestfit = 0;
	let lowest = Number.MAX_SAFE_INTEGER;
	const size = Math.min(256, palette.length);
	for (let i = 0; i < size; i++) {
		const entry = palette[i] as Rgba;
		const dg = (entry.g >> 3) - g5;
		const dr = (entry.r >> 3) - r5;
		const db = (entry.b >> 3) - b5;
		const da = (entry.a >> 3) - a5;
		const diff =
			dg * dg * 59 * 59 +
			dr * dr * 30 * 30 +
			db * db * 11 * 11 +
			da * da * 8 * 8;
		if (diff < lowest && i !== maskIndex) {
			if (diff === 0) return i;
			bestfit = i;
			lowest = diff;
		}
	}
	return bestfit;
}

class OctreeNode {
	r = 0;
	g = 0;
	b = 0;
	a = 0;
	pixelCount = 0;
	paletteIndex = -1;
	children: OctreeNode[] | undefined;
	parent: OctreeNode | undefined;

	get isLeaf(): boolean {
		return this.pixelCount > 0;
	}

	addChannels(r: number, g: number, b: number, a: number, count: number) {
		this.r += r;
		this.g += g;
		this.b += b;
		this.a += a;
		this.pixelCount += count;
	}

	addColor(
		color: Channels,
		level: number,
		parent: OctreeNode,
		paletteIndex: number,
		levelDeep: number,
	): void {
		this.parent = parent;
		if (level >= levelDeep) {
			this.addChannels(color[0], color[1], color[2], color[3], 1);
			this.paletteIndex = paletteIndex;
			return;
		}
		if (!this.children) {
			this.children = Array.from({ length: CHILDREN }, () => new OctreeNode());
		}
		(this.children[hextet(color, level)] as OctreeNode).addColor(
			color,
			level + 1,
			this,
			paletteIndex,
			levelDeep,
		);
	}

	mapColor(color: Channels, level: number, octree: OctreeMap): number {
		if (level >= 8) {
			if (this.paletteIndex === -1) {
				this.paletteIndex = octree.bestfit(color);
			}
			return this.paletteIndex;
		}
		if (!this.children) {
			this.children = Array.from({ length: CHILDREN }, () => new OctreeNode());
		}
		return (this.children[hextet(color, level)] as OctreeNode).mapColor(
			color,
			level + 1,
			octree,
		);
	}

	collectLeafNodes(leaves: OctreeNode[]): void {
		for (const child of this.children as OctreeNode[]) {
			if (child.isLeaf) {
				leaves.push(child);
			} else if (child.children) {
				child.collectLeafNodes(leaves);
			}
		}
	}

	/** Folds the leaf children into this node, which becomes a leaf. */
	removeLeaves(collapsed: OctreeNode[], rootLeaves: OctreeNode[]): void {
		const children = this.children as OctreeNode[];
		for (let i = CHILDREN - 1; i >= 0; i--) {
			const child = children[i] as OctreeNode;
			if (child.isLeaf) {
				this.addChannels(child.r, child.g, child.b, child.a, child.pixelCount);
				if (rootLeaves[rootLeaves.length - 1] === child) rootLeaves.pop();
			}
		}
		collapsed.push(this);
	}

	/** The mean colour, rounded up when the remainder is above half the count. */
	toRgba(): Rgba {
		const n = this.pixelCount;
		const channel = (sum: number) =>
			Math.trunc(sum / n + (sum % n > Math.trunc(n / 2) ? 1 : 0));
		return {
			r: channel(this.r),
			g: channel(this.g),
			b: channel(this.b),
			a: channel(this.a),
		};
	}
}

/**
 * A port of Aseprite's OctreeMap. Feed it images and call `makePalette` to
 * quantize, or call `regenerateMap` and then `mapColor` to map colours onto a
 * palette. `maskColor` null means the sprite has no transparent entry.
 */
export class OctreeMap {
	private root = new OctreeNode();
	private leaves: OctreeNode[] = [];
	private maskColor: Rgba | null = null;
	private palette: readonly Rgba[] = [];
	private maskIndex = -1;

	constructor() {
		this.root.parent = this.root;
	}

	addColor(color: Rgba, levelDeep = 7): void {
		this.root.addColor(
			[color.r, color.g, color.b, color.a],
			0,
			this.root,
			0,
			levelDeep,
		);
	}

	/** Alpha-0 pixels are skipped. Only RGBA images are accepted. */
	feedWithImage(
		image: Image,
		withAlpha: boolean,
		maskColor: Rgba | null,
		levelDeep = 7,
	): void {
		if (image.mode !== "rgba") {
			throw new CoreError(
				"unsupported",
				`Cannot quantize a ${image.mode} image`,
			);
		}
		const { data } = image;
		for (let i = 0; i < data.length; i += 4) {
			const a = data[i + 3] as number;
			if (a === 0) continue;
			this.addColor(
				{
					r: data[i] as number,
					g: data[i + 1] as number,
					b: data[i + 2] as number,
					a: withAlpha ? a : 255,
				},
				levelDeep,
			);
		}
		this.maskColor = maskColor;
	}

	/**
	 * The palette of at most `colorCount` entries, or undefined when a
	 * `levelDeep` of 8 would be more accurate, in which case the caller feeds a
	 * new map at that depth.
	 */
	makePalette(colorCount: number, levelDeep = 7): Rgba[] | undefined {
		if (this.root.children) this.root.collectLeafNodes(this.leaves);
		const leaves = this.leaves;
		if (this.maskColor !== null) colorCount--;
		if (levelDeep === 7 && leaves.length < colorCount) return undefined;

		const collapsed: OctreeNode[] = [];
		let keepReducing = true;
		for (let level = levelDeep; level > -1 && keepReducing; level--) {
			for (let i = leaves.length - 1; i >= 0; i--) {
				if (leaves.length + collapsed.length <= colorCount) {
					for (let j = 0; j < collapsed.length; j++) {
						leaves.push(collapsed[collapsed.length - 1 - j] as OctreeNode);
					}
					keepReducing = false;
					break;
				}
				if (leaves.length === 0) {
					if (collapsed.length <= 16 && colorCount < 16 && colorCount > 0) {
						// Aseprite sorts these by pixel count and then tries to blend the
						// rarest into their neighbours, but its blend adds to a copy, so the
						// rarest are simply dropped.
						const sorted = collapsed
							.map((node, order) => ({ node, order }))
							.sort(
								(x, y) =>
									y.node.pixelCount - x.node.pixelCount || x.order - y.order,
							)
							.map(({ node }) => node);
						leaves.push(...sorted.slice(0, colorCount));
						keepReducing = false;
					}
					break;
				}
				(leaves[leaves.length - 1] as OctreeNode).parent?.removeLeaves(
					collapsed,
					leaves,
				);
			}
			if (keepReducing) {
				for (let i = collapsed.length - 1; i >= 0; i--) {
					leaves.push(collapsed[i] as OctreeNode);
				}
				collapsed.length = 0;
			}
		}

		const colors = leaves.map((leaf) => leaf.toRgba());
		return this.maskColor === null ? colors : [this.maskColor, ...colors];
	}

	regenerateMap(palette: readonly Rgba[], maskIndex: number): void {
		this.palette = palette;
		this.maskIndex = maskIndex;
		this.root = new OctreeNode();
		this.root.parent = this.root;
		this.leaves = [];
		let maskColorBestfit = -1;
		if (maskIndex < 0) {
			this.maskColor = null;
		} else {
			const mask = palette[maskIndex] as Rgba;
			this.maskColor = mask;
			maskColorBestfit = findBestfit(
				palette,
				mask.r,
				mask.g,
				mask.b,
				mask.a,
				maskIndex,
			);
		}
		palette.forEach((entry, i) => {
			this.root.addColor(
				[entry.r, entry.g, entry.b, entry.a],
				0,
				this.root,
				i === maskIndex ? maskColorBestfit : i,
				8,
			);
		});
	}

	/** Walks the octree, so a colour with no exact match isn't always mapped to the nearest entry. */
	mapColor(r: number, g: number, b: number, a: number): number {
		return this.root.mapColor([r, g, b, a], 0, this);
	}

	/** @internal Used by octree nodes to fill in a leaf with no exact match. */
	bestfit([r, g, b, a]: Channels): number {
		return findBestfit(this.palette, r, g, b, a, this.maskIndex);
	}
}
