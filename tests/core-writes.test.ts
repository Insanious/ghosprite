// A guard, not a proof: it flags direct mutating calls on sprite collections
// and assignments to sprite-state fields outside src/core, so a write through a
// local alias gets past it. The Rust port makes the rule structural, since
// sprites then sit behind an opaque handle.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const srcDir = join(repoRoot, "src");
const coreDir = join(srcDir, "core");

const fields =
	"tags|slices|palettes|selections|cels|children|frameDurations|colors|image|opacity|zIndex|flags|userData|blendMode|width|height|mode|root|data";
const collections =
	"tags|slices|palettes|selections|cels|children|frameDurations";

const forbidden = [
	new RegExp(
		`\\.(${collections})\\.(splice|push|unshift|pop|shift|sort|reverse|set|delete|clear)\\(`,
	),
	new RegExp(`\\.(${fields})\\s*=(?!=)`),
	/insertTag\(sprite\.tags/,
];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return path === coreDir ? [] : sourceFiles(path);
		}
		return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
			? [path]
			: [];
	});
}

test("nothing outside src/core writes to sprite state", () => {
	const violations: string[] = [];
	for (const path of sourceFiles(srcDir)) {
		readFileSync(path, "utf8")
			.split("\n")
			.forEach((line, index) => {
				if (forbidden.some((pattern) => pattern.test(line))) {
					violations.push(
						`${relative(repoRoot, path)}:${index + 1}: ${line.trim()}`,
					);
				}
			});
	}
	expect(violations).toEqual([]);
});
