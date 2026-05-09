import { Hono } from "hono";
import { readState } from "./state";

export const DEFAULT_PORT = 3001;
export const HOSTNAME = "127.0.0.1";
export const DEFAULT_STATE_PATH = "data/state.json";
const WILDCARD_HOSTNAME = "0.0.0.0";

const statePath = () => Bun.env.TYPELING_STATE_PATH ?? DEFAULT_STATE_PATH;

export const app = new Hono();

app.get("/api/health", (c) => {
	return c.json({ ok: true });
});

app.get("/api/children", async (c) => {
	try {
		const state = await readState(statePath());
		return c.json(state.children);
	} catch (error) {
		console.error(error);
		const name = error instanceof Error ? error.name : "Error";
		return c.json({ error: name }, 500);
	}
});

const readPort = () => {
	const value = Bun.env.PORT;
	if (value === undefined || value === "") {
		return DEFAULT_PORT;
	}

	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`Invalid PORT: ${value}`);
	}

	return port;
};

const isWildcardAddressRequest = (request: Request) => {
	const urlHostname = new URL(request.url).hostname;
	const hostHeader = request.headers.get("host")?.split(":")[0];
	return urlHostname === WILDCARD_HOSTNAME || hostHeader === WILDCARD_HOSTNAME;
};

export const fetch = (request: Request) => {
	if (isWildcardAddressRequest(request)) {
		return Response.error();
	}

	return app.fetch(request);
};

if (import.meta.main) {
	const port = readPort();

	Bun.serve({
		fetch,
		hostname: HOSTNAME,
		port,
	});
	console.log(`Server running on http://${HOSTNAME}:${port}`);
}

export default fetch;
