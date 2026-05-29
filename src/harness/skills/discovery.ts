import { type App, normalizePath } from "obsidian";

/**
 * Discover every skill folder in the vault by scanning for `SKILL.md` files.
 * Returns the parent folder path of each `SKILL.md`, normalized and sorted.
 * The folder path is the stable identity used to enable/disable a skill.
 */
export function discoverSkillFolders(app: App): string[] {
  const folders = new Set<string>();
  for (const file of app.vault.getFiles()) {
    if (file.name !== "SKILL.md") continue;
    folders.add(normalizePath(file.parent?.path ?? ""));
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}
