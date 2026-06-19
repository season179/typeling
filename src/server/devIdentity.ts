import { type SignedInUser, signedInUserSchema } from "../lib/schemas/state";

/** Parse `TYPELING_IDENTITY` for the Bun `dev:direct` server (not Workers). */
export function readIdentityFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): SignedInUser | undefined {
	const raw = env.TYPELING_IDENTITY?.trim();
	if (!raw) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}

	const result = signedInUserSchema.safeParse(parsed);
	if (!result.success) return undefined;

	const email = result.data.email.trim().toLowerCase();
	return { ...result.data, email };
}
