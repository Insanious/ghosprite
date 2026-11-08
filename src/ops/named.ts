import { OpError } from "../errors.ts";

export function assertNameFree(
	items: { name: string }[],
	name: string,
	kind: string,
): void {
	if (items.some((item) => item.name === name)) {
		throw new OpError("invalid_input", `A ${kind} named "${name}" exists`, {
			path: "name",
			hint: `Choose a name no other ${kind} uses`,
		});
	}
}

export function indexOfNamed(
	items: { name: string }[],
	name: string,
	kind: string,
): number {
	const matches = items.flatMap((item, index) =>
		item.name === name ? [index] : [],
	);
	if (matches.length === 0) {
		throw new OpError("not_found", `No ${kind} named "${name}"`, {
			path: "name",
		});
	}
	if (matches.length > 1) {
		throw new OpError(
			"invalid_input",
			`${matches.length} ${kind}s are named "${name}"`,
			{
				path: "name",
				hint: `Rename the duplicate ${kind}s before deleting one`,
			},
		);
	}
	return matches[0] as number;
}
