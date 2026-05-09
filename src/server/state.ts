import { rename } from "node:fs/promises";
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

const fieldFromZodError = (error: ZodError) => {
	const issue = error.issues[0];
	if (!issue || issue.path.length === 0) return undefined;
	return issue.path.join(".");
};

export const ensureStateFile = async (
	statePath: string,
	seedPath: string,
): Promise<boolean> => {
	if (await Bun.file(statePath).exists()) return false;
	const seedText = await Bun.file(seedPath).text();
	const tmpPath = `${statePath}.tmp`;
	await Bun.write(tmpPath, seedText);
	await rename(tmpPath, statePath);
	return true;
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
			const field = fieldFromZodError(error);
			const detail = field ? ` at ${field}` : "";
			throw new StateParseError(
				`State schema violation${detail}: ${error.issues[0]?.message ?? "unknown"}`,
				field,
			);
		}
		throw error;
	}
};
