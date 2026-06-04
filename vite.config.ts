import { obsidian } from "@aliou/vite-plugin-obsidian";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { devNamespace } from "./build/dev-namespace";
import manifest from "./manifest.config";

export default defineConfig(({ mode }) => ({
  define: {
    "process.versions.node": "undefined",
    "process.versions.bun": "undefined",
  },
  plugins: [
    tsconfigPaths(),
    obsidian({
      entry: "src/main.ts",
      manifest,
      outDir: mode === "development" ? "dist-dev" : "dist",
    }),
    devNamespace(mode === "development"),
  ],
  resolve: {
    alias: [
      {
        find: /.*\/env-api-keys\.(js|ts)$/,
        replacement: "./src/shims/pi-ai-env.ts",
      },
      {
        find: /.*\/node-http-proxy\.(js|ts)$/,
        replacement: "./src/shims/pi-ai-node-http-proxy.ts",
      },
    ],
  },
  test: {
    alias: {
      obsidian: "./src/test/obsidian.ts",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
  },
}));
