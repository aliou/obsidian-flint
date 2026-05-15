import type { ExecutionEnv, FileInfo } from "@earendil-works/pi-agent-core";

export function text<T = unknown>(content: string, details?: T) {
  return {
    content: [{ type: "text" as const, text: content }],
    details: details as T,
  };
}

export function errorText<T = unknown>(message: string, details?: T) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: details as T,
  };
}

export function envPathToVaultPath(path: string): string {
  return path.replace(/^\/+/, "");
}

export function vaultPathToEnvPath(path: string): string {
  return `/${path.replace(/^\/+/, "")}`;
}

export function pathDisplayName(path: unknown): string {
  if (typeof path !== "string") return "/";
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "/";
  return normalized.split("/").pop() ?? normalized;
}

export async function listFilesRecursive(
  env: ExecutionEnv,
  path = "/",
): Promise<{ ok: true; files: FileInfo[] } | { ok: false; error: string }> {
  const root = await env.listDir(path);
  if (!root.ok) return { ok: false, error: root.error.message };

  const files: FileInfo[] = [];
  const directories = root.value.filter((entry) => entry.kind === "directory");
  files.push(...root.value.filter((entry) => entry.kind === "file"));

  for (const directory of directories) {
    const nested = await listFilesRecursive(env, directory.path);
    if (!nested.ok) return nested;
    files.push(...nested.files);
  }

  return { ok: true, files };
}

/** List all entries (files and directories) recursively. */
export async function listEntriesRecursive(
  env: ExecutionEnv,
  path = "/",
): Promise<{ ok: true; entries: FileInfo[] } | { ok: false; error: string }> {
  const root = await env.listDir(path);
  if (!root.ok) return { ok: false, error: root.error.message };

  const entries: FileInfo[] = [];
  const directories: FileInfo[] = [];

  for (const entry of root.value) {
    if (entry.kind === "directory") {
      directories.push(entry);
      entries.push(entry); // Include directories themselves.
    } else {
      entries.push(entry);
    }
  }

  for (const directory of directories) {
    const nested = await listEntriesRecursive(env, directory.path);
    if (!nested.ok) return nested;
    entries.push(...nested.entries);
  }

  return { ok: true, entries };
}
