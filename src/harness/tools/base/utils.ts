import { parseBase, validateBase } from "@aliou/obsdx-base-ast";
import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { envPathToVaultPath, listFilesRecursive } from "../utils";
import { inspectMarkdownFile } from "./metadata";

export async function parseBaseFile(env: ExecutionEnv, path: string) {
  const result = await env.readTextFile(path);
  if (!result.ok) return { ok: false as const, error: result.error.message };
  try {
    const base = parseBase(envPathToVaultPath(path), result.value);
    return {
      ok: true as const,
      raw: result.value,
      base,
      validationErrors: validateBase(base),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listFilesByExtension(
  env: ExecutionEnv,
  extension: string,
) {
  const listed = await listFilesRecursive(env);
  if (!listed.ok) return listed;
  return {
    ok: true as const,
    files: listed.files.filter((file) => file.name.endsWith(`.${extension}`)),
  };
}

export function markdownInspections(env: ExecutionEnv, app: App) {
  return listFilesByExtension(env, "md").then((result) => {
    if (!result.ok) return result;
    return {
      ok: true as const,
      inspections: result.files.flatMap((file) => {
        const abstractFile = app.vault.getAbstractFileByPath(
          envPathToVaultPath(file.path),
        );
        return abstractFile instanceof TFile
          ? [inspectMarkdownFile(app, abstractFile)]
          : [];
      }),
    };
  });
}
