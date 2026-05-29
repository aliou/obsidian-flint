import { defineManifest } from "@aliou/vite-plugin-obsidian";
import pkg from "./package.json";

export default defineManifest(({ mode }) => {
  const isDev = mode === "development";
  const id = pkg.name.replace(/^obsidian-/, "");
  return {
    id: isDev ? `${id}-dev` : id,
    name: isDev ? "Flint (dev)" : "Flint",
    version: isDev ? `${pkg.version}-next` : pkg.version,
    minAppVersion: "1.13.0",
    description: pkg.description,
    author: pkg.author,
    isDesktopOnly: false,
  };
});
