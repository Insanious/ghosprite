export type CoreErrorCode =
	| "invalid_input"
	| "not_found"
	| "out_of_range"
	| "unsupported";

export class CoreError extends Error {
	readonly code: CoreErrorCode;
	readonly hint?: string;

	constructor(code: CoreErrorCode, message: string, hint?: string) {
		super(message);
		this.name = "CoreError";
		this.code = code;
		this.hint = hint;
	}
}
