import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = process.env.INKY_API_PORT || env.INKY_API_PORT || "8001";
  const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || `http://localhost:${apiPort}`;

  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": apiProxyTarget
      }
    }
  };
});
