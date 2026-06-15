import { type SignedInUser, signedInUserSchema } from "../lib/schemas/state";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const DEV_USER_EMAIL = "dev@typeling.localhost";

type JsonRecord = Record<string, unknown>;

export type CurrentUserResponse =
	| { authenticated: false }
	| { authenticated: true; user: SignedInUser };

export const devSignedInUser = signedInUserSchema.parse({
	email: DEV_USER_EMAIL,
	name: "Typeling Dev",
	display_name: "Typeling Dev",
	access_subject: "local-dev",
});

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function accessIdentityFromRequest(
	request: Request,
): SignedInUser | null {
	const token = request.headers.get(ACCESS_JWT_HEADER);
	if (!token) return null;

	const claims = decodeJwtPayload(token);
	if (!isRecord(claims)) return null;

	const email =
		stringClaim(claims, "email") ?? nestedString(claims, "idp", "email");
	if (!email) return null;

	const name = displayNameFromClaims(claims);
	const accessSubject = stringClaim(claims, "sub");
	const parsed = signedInUserSchema.safeParse({
		email: normalizeEmail(email),
		...(name ? { name } : {}),
		display_name: name ?? email,
		...(accessSubject ? { access_subject: accessSubject } : {}),
	});

	return parsed.success ? parsed.data : null;
}

export function currentUserResponse(request: Request): CurrentUserResponse {
	const user = accessIdentityFromRequest(request);
	return user ? { authenticated: true, user } : { authenticated: false };
}

function decodeJwtPayload(token: string): unknown {
	const payload = token.split(".")[1];
	if (!payload) return null;

	try {
		return JSON.parse(decodeBase64Url(payload));
	} catch {
		return null;
	}
}

function decodeBase64Url(input: string): string {
	const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function displayNameFromClaims(claims: JsonRecord): string | undefined {
	return firstString([
		stringClaim(claims, "name"),
		nestedString(claims, "oidc_fields", "name"),
		nestedString(claims, "custom", "name"),
		nestedString(claims, "idp", "name"),
		joinedNameParts(claims),
		nestedNameParts(claims, "oidc_fields"),
		nestedNameParts(claims, "custom"),
		nestedNameParts(claims, "idp"),
	]);
}

function nestedNameParts(record: JsonRecord, key: string): string | undefined {
	const nested = recordAt(record, key);
	return nested ? joinedNameParts(nested) : undefined;
}

function joinedNameParts(record: JsonRecord): string | undefined {
	return firstString([
		[stringClaim(record, "given_name"), stringClaim(record, "family_name")]
			.filter(Boolean)
			.join(" "),
	]);
}

function nestedString(
	record: JsonRecord,
	key: string,
	nestedKey: string,
): string | undefined {
	const nested = recordAt(record, key);
	return nested ? stringClaim(nested, nestedKey) : undefined;
}

function recordAt(record: JsonRecord, key: string): JsonRecord | undefined {
	const value = record[key];
	return isRecord(value) ? value : undefined;
}

function stringClaim(record: JsonRecord, key: string): string | undefined {
	const value = record[key];
	if (typeof value !== "string") return undefined;

	const trimmed = value.replace(/\s+/g, " ").trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function firstString(values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (value && value.trim().length > 0) return value;
	}
	return undefined;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
