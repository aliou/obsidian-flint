import type { App } from "obsidian";

/** Segment-level blocklist: any path component starting with `.` is hidden. */
export function isBlockedVaultPath(path: string): boolean {
  // Normalise: strip leading slashes, split into segments.
  const normalized = path.replace(/^\/+/, "");
  if (!normalized) return false; // root is fine
  const segments = normalized.split("/");
  return segments.some((seg) => seg.startsWith(".") || seg === ".DS_Store");
}

/** Return a concise error string for a blocked path. */
export function blockedPathMessage(path: string): string {
  return `Path is not accessible: ${path}`;
}

/**
 * Normalize a user-supplied tool path.
 *
 * Returns three representations:
 * - `envPath`: absolute-looking env path with leading `/` (e.g. `/Notes/Alpha.md`)
 * - `vaultPath`: Obsidian-internal relative path without leading `/` (e.g. `Notes/Alpha.md`)
 * - `displayPath`: content-friendly relative path without leading `/` (same as vaultPath)
 *
 * Rejects:
 * - Paths that traverse above root (`..`)
 * - Absolute filesystem paths (starting with `/` on the real FS is handled; we just normalise)
 * - Blocked paths (dot segments)
 */
export function normalizeVaultToolPath(input: string): {
  envPath: string;
  vaultPath: string;
  displayPath: string;
} {
  // Strip leading slashes for processing, then rebuild.
  let raw = input.replace(/^\/+/, "");
  // Collapse redundant slashes.
  raw = raw.replace(/\/+/g, "/");
  // Remove trailing slash (unless root).
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);

  // Reject traversal.
  const segments = raw.split("/").filter(Boolean);
  if (segments.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${input}`);
  }

  const vaultPath = segments.join("/");
  const envPath = vaultPath ? `/${vaultPath}` : "/";

  return { envPath, vaultPath, displayPath: vaultPath };
}

/**
 * Validate a tool path and return either a valid resolved path set or an error.
 * This is the main entry point for tools that need path validation.
 */
export function validateToolPath(
  input: string,
):
  | { ok: true; envPath: string; vaultPath: string; displayPath: string }
  | { ok: false; error: string } {
  try {
    const result = normalizeVaultToolPath(input);
    if (isBlockedVaultPath(result.envPath)) {
      return { ok: false, error: blockedPathMessage(result.envPath) };
    }
    return { ok: true, ...result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** File kind labels for display. */
export type FileKind = "note" | "base" | "file" | "folder";

/** Determine the kind of a vault entry from its name and type. */
export function kindForFile(file: { kind?: string; name: string }): FileKind {
  if (file.kind === "directory") return "folder";
  if (file.name.endsWith(".md")) return "note";
  if (file.name.endsWith(".base")) return "base";
  return "file";
}

/** Check if a file extension is text-readable for search/read. */
export function isTextReadable(name: string): boolean {
  const ext = name.includes(".")
    ? (name.split(".").pop() ?? "").toLowerCase()
    : "";
  return TEXT_READABLE_EXTENSIONS.has(ext);
}

const TEXT_READABLE_EXTENSIONS = new Set([
  "md",
  "base",
  "txt",
  "json",
  "csv",
  "yaml",
  "yml",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "sh",
  "py",
  "toml",
  "ini",
  "env",
  "log",
  "svg",
]);

/** Filter a list of file info objects, removing blocked entries. */
export function filterVisibleFiles<T extends { name: string; path: string }>(
  files: T[],
): T[] {
  return files.filter((f) => !isBlockedVaultPath(f.path));
}

/** Filter a list of directory entries, removing blocked entries. */
export function filterVisibleEntries<T extends { name: string; path: string }>(
  entries: T[],
): T[] {
  return entries.filter((e) => !isBlockedVaultPath(e.path));
}

/**
 * Minimal glob matching for Obsidian vault paths.
 *
 * Supports:
 * - `*` matches any sequence of characters within a single path segment
 * - `**` matches any sequence of characters across segments
 * - `?` matches a single character
 * - Literal characters otherwise
 *
 * If the pattern has no glob metacharacters (`*`, `?`), it is treated as a
 * substring match against the full path.
 */
export function matchGlob(pattern: string, path: string): boolean {
  // If no glob metacharacters, do substring match.
  if (!/[*?]/.test(pattern)) {
    return path.toLowerCase().includes(pattern.toLowerCase());
  }

  // Convert glob to regex.
  const regex = globToRegex(pattern);
  return regex.test(path);
}

/**
 * Match a user-facing vault pattern against a path.
 *
 * Obsidian does not expose a vault-wide glob API; callers enumerate vault files
 * via `Vault.getFiles()` / `Vault.getAllLoadedFiles()` and apply matching in
 * plugin code. To match Pi/fd-style expectations, basename-only patterns like
 * `*.md` match files in any folder, while path patterns with folders such as
 * `Notes/*.md` match against the scoped relative path.
 */
export function matchVaultPattern(
  pattern: string,
  relativePath: string,
): boolean {
  const normalizedPath = relativePath.replace(/^\/+/, "");
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  if (pattern.includes("/")) return matchGlob(pattern, normalizedPath);
  return matchGlob(pattern, basename) || matchGlob(pattern, normalizedPath);
}

// Characters that need escaping in regex patterns.
const ESCAPE_CHARS = new Set([
  ".",
  "+",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
  "\\",
]);

function globToRegex(pattern: string): RegExp {
  const parts: string[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      // `**` matches across segments.
      parts.push(".*");
      i += 2;
      // Consume optional trailing `/` after `**`.
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      // `*` matches within a single segment.
      parts.push("[^/]*");
      i++;
    } else if (ch === "?") {
      parts.push("[^/]");
      i++;
    } else if (ESCAPE_CHARS.has(ch)) {
      parts.push(`\\${ch}`);
      i++;
    } else {
      parts.push(ch);
      i++;
    }
  }
  return new RegExp(`^${parts.join("")}$`, "i");
}

/**
 * Property type inference.
 * Used when `.obsidian/types.json` does not provide a type.
 */
export function inferPropertyType(value: unknown): string {
  if (Array.isArray(value)) return "list";
  if (typeof value === "string") {
    // Try to detect date-like strings.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
    return "text";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  return "unknown";
}

/** Note property record for details. */
export interface NoteProperty {
  name: string;
  value: unknown;
  type: string;
}

/**
 * Load property types from `.obsidian/types.json`.
 * This is read internally only; it is never exposed to the agent.
 * Returns `{}` silently if unreadable or missing.
 */
export async function loadPropertyTypes(
  app: App,
): Promise<Record<string, string>> {
  try {
    const exists = await app.vault.adapter.exists(".obsidian/types.json");
    if (!exists) return {};
    const raw = await app.vault.adapter.read(".obsidian/types.json");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "types" in parsed) {
      return (parsed as { types: Record<string, string> }).types;
    }
    return {};
  } catch {
    return {};
  }
}
