import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, type UserConfig, defineConfig } from "vite";
import { DEFAULT_PORT, HOSTNAME } from "./src/server/config";

export function resolveServerUrl(env: NodeJS.ProcessEnv = process.env): string {
	const serverPort = Number(env.SERVER_PORT) || DEFAULT_PORT;
	return env.SERVER_URL || `http://${HOSTNAME}:${serverPort}`;
}

const cloudflareEnabled = process.env.TYPELING_CLOUDFLARE === "1";

function createPlugins(): PluginOption[] {
	const plugins: PluginOption[] = [react(), tailwindcss()];
	if (!cloudflareEnabled) {
		return plugins;
	}

	return [
		...plugins,
		cloudflare({
			configPath: "../../wrangler.jsonc",
			inspectorPort: false,
		}),
	];
}

function createServerConfig(): NonNullable<UserConfig["server"]> {
	if (cloudflareEnabled) {
		return { host: HOSTNAME };
	}

	return {
		host: HOSTNAME,
		proxy: {
			"/api": {
				target: resolveServerUrl(),
				changeOrigin: true,
			},
		},
	};
}

export default defineConfig({
	root: "src/web",
	plugins: createPlugins(),
	server: createServerConfig(),
	build: {
		outDir: "../../dist/client",
		emptyOutDir: true,
	},
});
