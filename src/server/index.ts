import { Hono } from "hono";

export const DEFAULT_PORT = 3001;
export const HOSTNAME = "127.0.0.1";
const WILDCARD_HOSTNAME = "0.0.0.0";

export const app = new Hono();

app.get("/api/health", (c) => {
	return c.json({ ok: true });
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
