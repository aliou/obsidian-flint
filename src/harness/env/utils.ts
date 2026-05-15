import {
  err,
  FileError,
  ok,
  type Result,
  toError,
} from "@earendil-works/pi-agent-core";
import { type App, normalizePath } from "obsidian";

export function normalizeEnvPath(cwd: string, path: string): string {
  const raw = path.startsWith("/")
    ? path
    : `${cwd.replace(/\/+$/, "")}/${path}`;
  const normalized = normalizePath(raw).replace(/^\/+/, "");
  return normalized ? `/${normalized}` : "/";
}

export function toVaultPath(envPath: string): string {
  return normalizePath(envPath.replace(/^\/+/, ""));
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

/** Returns true if the resolved vault path contains any dot-prefixed segment (e.g. .obsidian, .pi, .DS_Store). */
export function isBlockedPath(path: string): boolean {
  const normalized = path.replace(/^\/+/, "");
  if (!normalized) return false;
  const segments = normalized.split("/");
  return segments.some((seg) => seg.startsWith(".") || seg === ".DS_Store");
}

export function blockedPathError(path: string): FileError {
  return new FileError("not_found", `Path not found: ${path}`, path);
}

export function toFileError(error: unknown, path?: string): FileError {
  if (error instanceof FileError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const cause = toError(error);
  if (/not found|does not exist|no such/i.test(message))
    return new FileError("not_found", message, path, cause);
  if (/not a folder|not directory/i.test(message))
    return new FileError("not_directory", message, path, cause);
  if (/folder|directory/i.test(message) && /is/i.test(message))
    return new FileError("is_directory", message, path, cause);
  return new FileError("unknown", message, path, cause);
}

export function uint8ToArrayBuffer(content: Uint8Array): ArrayBuffer {
  return content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer;
}

export async function ensureParentDirs(
  app: App,
  envPath: string,
): Promise<Result<void, FileError>> {
  const parent = dirname(envPath);
  if (parent === "/") return ok(undefined);
  const parts = parent.replace(/^\/+/, "").split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      const exists = await app.vault.adapter.exists(current);
      if (!exists) {
        await app.vault.adapter.mkdir(current);
      }
    } catch (error) {
      return err(toFileError(error, `/${current}`));
    }
  }
  return ok(undefined);
}
