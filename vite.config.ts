import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_PORT, HOSTNAME } from "./src/server/index.ts";

export const resolveServerUrl = (env: NodeJS.ProcessEnv = process.env) => {
  const serverPort = Number(env.SERVER_PORT) || DEFAULT_PORT;
  return env.SERVER_URL || `http://${HOSTNAME}:${serverPort}`;
};

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  server: {
    host: HOSTNAME,
    proxy: {
      "/api": {
        target: resolveServerUrl(),
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
