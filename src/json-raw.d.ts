// TypeScript's ESNext lib doesn't declare these two JSON features yet.
interface JSON {
	rawJSON(text: string): object;
	parse(
		text: string,
		reviver: (
			this: unknown,
			key: string,
			value: unknown,
			context: { source: string },
		) => unknown,
	): unknown;
}
