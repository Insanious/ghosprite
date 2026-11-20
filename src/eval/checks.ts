import type { Image, Sprite } from "../core/index.ts";

export type CheckResult = { pass: boolean; detail: string };
export type Check = {
	name: string;
	part: string;
	run: (sprites: Sprite[]) => CheckResult;
};
export type EvalDefinition = { parts: string[]; checks: Check[] };

export function runChecks(
	definition: EvalDefinition,
	sprites: Sprite[],
): {
	checks: (CheckResult & { name: string; part: string })[];
	unchecked: string[];
} {
	const checks = definition.checks.map((check) => {
		let result: CheckResult;
		try {
			result = check.run(sprites);
		} catch (error) {
			result = {
				pass: false,
				detail: error instanceof Error ? error.message : String(error),
			};
		}
		return { name: check.name, part: check.part, ...result };
	});
	const checkedParts = new Set(definition.checks.map((check) => check.part));
	return {
		checks,
		unchecked: definition.parts.filter((part) => !checkedParts.has(part)),
	};
}

export type AlphaCounts = {
	opaque: number;
	translucent: number;
	nonEmpty: number;
};

export function alphaCounts(image: Image): AlphaCounts {
	let opaque = 0;
	let translucent = 0;
	for (let i = 3; i < image.data.length; i += 4) {
		const alpha = image.data[i] as number;
		if (alpha === 255) opaque++;
		else if (alpha > 0) translucent++;
	}
	return { opaque, translucent, nonEmpty: opaque + translucent };
}

export function opaqueCoverage(image: Image): number {
	return alphaCounts(image).opaque / (image.width * image.height);
}

export function alphaCentroid(image: Image): { x: number; y: number } | null {
	let weight = 0;
	let sumX = 0;
	let sumY = 0;
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const alpha = image.data[(y * image.width + x) * 4 + 3] as number;
			weight += alpha;
			sumX += alpha * x;
			sumY += alpha * y;
		}
	}
	return weight === 0 ? null : { x: sumX / weight, y: sumY / weight };
}
