export type OpErrorCode =
	| "invalid_input"
	| "unknown_op"
	| "not_found"
	| "out_of_range"
	| "unsupported"
	| "internal";

export type OpErrorInfo = {
	code: OpErrorCode;
	message: string;
	path: string;
	hint?: string;
};

export class OpError extends Error {
	readonly code: OpErrorCode;
	readonly path: string;
	readonly hint?: string;

	constructor(
		code: OpErrorCode,
		message: string,
		options: { path?: string; hint?: string } = {},
	) {
		super(message);
		this.name = "OpError";
		this.code = code;
		this.path = options.path ?? "";
		this.hint = options.hint;
	}

	toJSON(): OpErrorInfo {
		const info: OpErrorInfo = {
			code: this.code,
			message: this.message,
			path: this.path,
		};
		if (this.hint !== undefined) info.hint = this.hint;
		return info;
	}
}
