import {
  type ExecutionEnv,
  type ExecutionEnvExecOptions,
  ExecutionError,
  err,
  FileError,
  type FileInfo,
  ok,
  type Result,
} from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import {
  basename,
  blockedPathError,
  ensureParentDirs,
  isBlockedPath,
  normalizeEnvPath,
  toFileError,
  toVaultPath,
  uint8ToArrayBuffer,
} from "./utils";

/** ExecutionEnv backed by the current Obsidian vault. Paths are absolute-looking vault paths. */
export class ObsidianExecutionEnv implements ExecutionEnv {
  cwd: string;

  constructor(
    private readonly app: App,
    options?: { cwd?: string },
  ) {
    this.cwd = normalizeEnvPath("/", options?.cwd ?? "/");
  }

  async exec(
    _command: string,
    _options?: ExecutionEnvExecOptions,
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  > {
    return err(
      new ExecutionError(
        "shell_unavailable",
        "Shell execution is not supported by the Obsidian vault environment",
      ),
    );
  }

  async readTextFile(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const content = await this.app.vault.adapter.read(toVaultPath(resolved));
      return ok(content);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const result = await this.readTextFile(path, options?.abortSignal);
    if (!result.ok) return result;
    const lines = result.value.split(/\r?\n/);
    return ok(
      options?.maxLines === undefined
        ? lines
        : lines.slice(0, options.maxLines),
    );
  }

  async readBinaryFile(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<Uint8Array, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const buffer = await this.app.vault.adapter.readBinary(
        toVaultPath(resolved),
      );
      return ok(new Uint8Array(buffer));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async writeFile(
    path: string,
    content: string | Uint8Array,
    _abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const parentResult = await ensureParentDirs(this.app, resolved);
      if (!parentResult.ok) return parentResult;
      if (typeof content === "string") {
        await this.app.vault.adapter.write(toVaultPath(resolved), content);
      } else {
        await this.app.vault.adapter.writeBinary(
          toVaultPath(resolved),
          uint8ToArrayBuffer(content),
        );
      }
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async appendFile(
    path: string,
    content: string | Uint8Array,
    _abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const parentResult = await ensureParentDirs(this.app, resolved);
      if (!parentResult.ok) return parentResult;
      const vaultPath = toVaultPath(resolved);
      if (typeof content === "string") {
        const exists = await this.app.vault.adapter.exists(vaultPath);
        const existing = exists
          ? await this.app.vault.adapter.read(vaultPath)
          : "";
        await this.app.vault.adapter.write(vaultPath, existing + content);
      } else {
        const exists = await this.app.vault.adapter.exists(vaultPath);
        let existing: Uint8Array;
        if (exists) {
          const raw = await this.app.vault.adapter.readBinary(vaultPath);
          existing = new Uint8Array(raw);
        } else {
          existing = new Uint8Array(0);
        }
        const merged = new Uint8Array(existing.length + content.length);
        merged.set(existing);
        merged.set(content, existing.length);
        await this.app.vault.adapter.writeBinary(
          vaultPath,
          uint8ToArrayBuffer(merged),
        );
      }
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async fileInfo(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const stat = await this.app.vault.adapter.stat(toVaultPath(resolved));
      if (!stat)
        return err(
          new FileError("not_found", `Path not found: ${resolved}`, resolved),
        );
      return ok({
        name: basename(resolved),
        path: resolved,
        kind: stat.type === "folder" ? "directory" : "file",
        size: stat.size,
        mtimeMs: stat.mtime,
      });
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async listDir(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      const listed = await this.app.vault.adapter.list(toVaultPath(resolved));
      const paths = [...listed.folders, ...listed.files].filter(
        (entry) => !isBlockedPath(`/${entry}`),
      );
      const results = await Promise.all(
        paths.map((entry) => this.fileInfo(`/${entry}`)),
      );
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) return failed;
      return ok(results.map((r) => (r as { ok: true; value: FileInfo }).value));
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async absolutePath(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    return ok(normalizeEnvPath(this.cwd, path));
  }

  async joinPath(
    parts: string[],
    _abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    if (parts.length === 0) return ok(this.cwd);
    const first = parts[0];
    if (first === undefined) return ok(this.cwd);
    let resolved = normalizeEnvPath(this.cwd, first);
    for (const part of parts.slice(1)) {
      resolved = normalizeEnvPath(resolved, part);
    }
    return ok(resolved);
  }

  async canonicalPath(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    return ok(normalizeEnvPath(this.cwd, path));
  }

  async exists(
    path: string,
    _abortSignal?: AbortSignal,
  ): Promise<Result<boolean, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return ok(false);
    try {
      const result = await this.app.vault.adapter.exists(toVaultPath(resolved));
      return ok(result);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) return err(blockedPathError(resolved));
    try {
      if (options?.recursive) {
        const parentResult = await ensureParentDirs(
          this.app,
          `${resolved}/child`,
        );
        if (!parentResult.ok) return parentResult;
      }
      const exists = await this.app.vault.adapter.exists(toVaultPath(resolved));
      if (!exists) {
        await this.app.vault.adapter.mkdir(toVaultPath(resolved));
      }
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    },
  ): Promise<Result<void, FileError>> {
    const resolved = normalizeEnvPath(this.cwd, path);
    if (isBlockedPath(resolved)) {
      if (options?.force) return ok(undefined);
      return err(blockedPathError(resolved));
    }
    try {
      const stat = await this.app.vault.adapter.stat(toVaultPath(resolved));
      if (!stat) {
        if (options?.force) return ok(undefined);
        return err(
          new FileError("not_found", `Path not found: ${resolved}`, resolved),
        );
      }
      if (stat.type === "folder")
        await this.app.vault.adapter.rmdir(
          toVaultPath(resolved),
          options?.recursive ?? false,
        );
      else await this.app.vault.adapter.remove(toVaultPath(resolved));
      return ok(undefined);
    } catch (error) {
      return err(toFileError(error, resolved));
    }
  }

  async createTempDir(
    prefix = "tmp-",
    _abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const path = `/.pi/tmp/${prefix}${Date.now().toString(36)}`;
    try {
      const parentResult = await ensureParentDirs(this.app, `${path}/child`);
      if (!parentResult.ok) return parentResult;
      const vaultPath = toVaultPath(path);
      const exists = await this.app.vault.adapter.exists(vaultPath);
      if (!exists) await this.app.vault.adapter.mkdir(vaultPath);
      return ok(path);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    const dirResult = await this.createTempDir("tmp-");
    if (!dirResult.ok) return dirResult;
    const path = `${dirResult.value}/${options?.prefix ?? ""}${Date.now().toString(36)}${options?.suffix ?? ""}`;
    try {
      await this.app.vault.adapter.write(toVaultPath(path), "");
      return ok(path);
    } catch (error) {
      return err(toFileError(error, path));
    }
  }

  async cleanup(): Promise<void> {}
}
