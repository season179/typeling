import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Base class for any error that maps to a deterministic HTTP response.
 *
 * `status` is the HTTP status code and `code` is the stable machine-readable
 * string placed in the `{ error: code }` response body. `message` defaults to
 * `code` but can carry a richer description for logs without changing the
 * client-facing contract.
 *
 * `status` is a `ContentfulStatusCode` so the `{ error: code }` body is always
 * valid for the status; a contentless code (e.g. 204) is a compile error at the
 * construction site rather than an invalid response at runtime.
 *
 * The single seam that turns these into responses is the Hono `app.onError`
 * handler; route handlers throw `HttpError` subclasses and never map errors to
 * responses themselves.
 */
export class HttpError extends Error {
	readonly status: ContentfulStatusCode;
	readonly code: string;

	constructor(
		code: string,
		status: ContentfulStatusCode,
		message: string = code,
	) {
		super(message);
		this.name = "HttpError";
		this.code = code;
		this.status = status;
	}
}
