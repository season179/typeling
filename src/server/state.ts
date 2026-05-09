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

type StateErrorCtor = new (
	message: string,
	field?: string,
) => Error & {
	field?: string;
};

const toSchemaError = (error: unknown, ErrorCtor: StateErrorCtor): unknown => {
	if (!(error instanceof ZodError)) return error;
	const field = fieldFromZodError(error);
	const detail = field ? ` at ${field}` : "";
	return new ErrorCtor(
		`State schema violation${detail}: ${error.issues[0]?.message ?? "unknown"}`,
		field,
	);
};

export class StateValidationError extends Error {
	readonly field?: string;

	constructor(message: string, field?: string) {
		super(message);
		this.name = "StateValidationError";
		this.field = field;
	}
}

export const writeStateAtomic = async (
	state: State,
	statePath: string,
): Promise<void> => {
	try {
		stateSchema.parse(state);
	} catch (error) {
		throw toSchemaError(error, StateValidationError);
	}

	const existing = Bun.file(statePath);
	if (await existing.exists()) {
		await Bun.write(`${statePath}.bak`, existing);
	}

	const tmpPath = `${statePath}.tmp`;
	await Bun.write(tmpPath, JSON.stringify(state));
	await rename(tmpPath, statePath);
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

export type MutateFn = (current: State) => State;

export function createStateQueue(statePath: string): {
	mutateState: (fn: MutateFn) => Promise<State>;
	readState: () => Promise<State>;
} {
	let queue = Promise.resolve();

	return {
		mutateState(fn: MutateFn): Promise<State> {
			const { promise, resolve, reject } = Promise.withResolvers<State>();
			queue = queue.then(async () => {
				try {
					const current = await readState(statePath);
					const next = fn(current);
					if (next !== current) {
						await writeStateAtomic(next, statePath);
					}
					resolve(next);
				} catch (error) {
					reject(error);
				}
			});
			return promise;
		},
		readState(): Promise<State> {
			return readState(statePath);
		},
	};
}

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
		throw toSchemaError(error, StateParseError);
	}
};
