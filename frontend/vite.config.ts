import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL("..", import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const apiPort = process.env.INKY_API_PORT || env.INKY_API_PORT || "8001";
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET || env.VITE_API_PROXY_TARGET || `http://localhost:${apiPort}`;
  const buildVersion = formatBuildVersion(new Date());

  return {
    base: "./",
    define: {
      __INKY_BUILD_VERSION__: JSON.stringify(buildVersion)
    },
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

function formatBuildVersion(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${value("year")}.${value("month")}.${value("day")}.${value("hour")}${value("minute")}${value("second")}`;
}
