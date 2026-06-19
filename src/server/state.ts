import { ZodError } from "zod";
import { type State, stateSchema } from "../lib/schemas/state";

export class StateParseError extends Error {
	readonly field?: string;

	constructor(message: string, field?: string) {
		super(message);
		this.name = "StateParseError";
		this.field = field;
	}
}

const schemaParseError = (error: ZodError): StateParseError => {
	const issue = error.issues[0];
	const field =
		issue && issue.path.length > 0 ? issue.path.join(".") : undefined;
	const detail = field ? ` at ${field}` : "";
	return new StateParseError(
		`State schema violation${detail}: ${issue?.message ?? "unknown"}`,
		field,
	);
};

export const readState = async (path: string): Promise<State> => {
	let parsed: unknown;
	try {
		parsed = await Bun.file(path).json();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new StateParseError(`Invalid JSON in ${path}: ${message}`);
	}

	try {
		return stateSchema.parse(parsed);
	} catch (error) {
		if (error instanceof ZodError) {
			throw schemaParseError(error);
		}
		throw error;
	}
};
