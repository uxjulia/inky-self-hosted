import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const apiPort = process.env.INKY_API_PORT || env.INKY_API_PORT || "8001";
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || `http://localhost:${apiPort}`;

  return {
    base: "./",
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": apiProxyTarget
      }
    }
  };
});
