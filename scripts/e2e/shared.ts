/**
 * Shared helpers for agent-browser E2E scripts.
 *
 * Requires `dev:direct` with TYPELING_IDENTITY set — see README.md.
 */

export const BASE_URL = "http://127.0.0.1:5173";
export const E2E_STORY_SLUG = "rainbow-door-s1";
export const E2E_STORY_NAME = "The Rainbow Door";

export const AGENT_BROWSER_INSTALL =
	"bun add -g agent-browser && agent-browser install";

export const DEV_SERVER_HINT =
	`Dev server not reachable at ${BASE_URL}. Start it first:\n` +
	`  TYPELING_IDENTITY='{"email":"e2e@typeling.dev","display_name":"E2E"}' bun run dev:direct`;

export type AgentResult = { stdout: string; stderr: string; exitCode: number };

export async function agent(args: string[]): Promise<AgentResult> {
	const proc = Bun.spawn(["agent-browser", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

export async function run(...args: string[]): Promise<string> {
	const { stdout, stderr, exitCode } = await agent(args);
	if (exitCode !== 0) {
		const cmd = args.join(" ");
		const detail = stderr.trim() || `exit code ${exitCode}`;
		throw new Error(`agent-browser ${cmd} failed: ${detail}`);
	}
	return stdout;
}

export async function requireAgentBrowser(): Promise<void> {
	const which = Bun.spawnSync(["which", "agent-browser"]);
	if (which.exitCode !== 0) {
		throw new Error(
			`agent-browser not found. Install it:\n  ${AGENT_BROWSER_INSTALL}`,
		);
	}
}

export async function requireDevServer(): Promise<void> {
	let healthOk = false;
	try {
		const res = await fetch(`${BASE_URL}/api/health`);
		healthOk = res.ok;
	} catch {
		// checked below
	}
	if (!healthOk) {
		throw new Error(DEV_SERVER_HINT);
	}

	const progressRes = await fetch(`${BASE_URL}/api/progress`);
	if (progressRes.status === 401) {
		throw new Error(
			`${DEV_SERVER_HINT}\n\n/api/progress returned 401 — TYPELING_IDENTITY must be set on the server process.`,
		);
	}
	if (!progressRes.ok) {
		throw new Error(`/api/progress returned ${progressRes.status}`);
	}
}

export async function closeBrowser(): Promise<void> {
	try {
		await agent(["close", "--all"]);
	} catch {
		// browser may already be closed
	}
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
