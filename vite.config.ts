import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { DEFAULT_PORT, HOSTNAME } from "./src/server/index.ts";

const port = Number(process.env.PORT) || DEFAULT_PORT;

export default defineConfig({
  root: "src/web",
  plugins: [react(), tailwindcss()],
  server: {
    host: HOSTNAME,
    proxy: {
      "/api": {
        target: `http://${HOSTNAME}:${port}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
