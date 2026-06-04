import type {
  SessionRepo,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { Session, SessionError } from "@earendil-works/pi-agent-core";
import { type App, normalizePath } from "obsidian";
import { ObsidianJsonlSessionStorage } from "./storage";
import type { FlintSessionMetadata } from "./types";
import { now } from "./utils";

export class ObsidianSessionRepo
  implements SessionRepo<FlintSessionMetadata, { id?: string }, void>
{
  constructor(
    private readonly app: App,
    private readonly root = "Flint/Sessions",
  ) {}

  async create(
    options: { id?: string } = {},
  ): Promise<Session<FlintSessionMetadata>> {
    const sessionId = options.id ?? crypto.randomUUID();
    const path = normalizePath(
      `${this.root}/${now().replace(/[:.]/g, "-")}_${sessionId}.jsonl`,
    );
    const storage = await ObsidianJsonlSessionStorage.create(
      this.app,
      path,
      sessionId,
    );
    return new Session(storage);
  }

  async open(
    metadata: FlintSessionMetadata,
  ): Promise<Session<FlintSessionMetadata>> {
    const storage = await ObsidianJsonlSessionStorage.open(
      this.app,
      metadata.path,
    );
    return new Session(storage);
  }

  async list(): Promise<FlintSessionMetadata[]> {
    const exists = await this.app.vault.adapter.exists(this.root);
    if (!exists) return [];
    const listed = await this.app.vault.adapter.list(this.root);
    const sessions: FlintSessionMetadata[] = [];
    for (const path of listed.files.filter((file) => file.endsWith(".jsonl"))) {
      try {
        const storage = await ObsidianJsonlSessionStorage.open(this.app, path);
        const meta = await storage.getMetadata();
        sessions.push(meta);
      } catch (_) {
        void _;
      }
    }
    return sessions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async delete(metadata: FlintSessionMetadata): Promise<void> {
    const path = normalizePath(metadata.path);
    const root = normalizePath(this.root);
    if (!path.startsWith(`${root}/`) || !path.endsWith(".jsonl")) {
      throw new Error(`Refusing to delete non-session path: ${metadata.path}`);
    }
    const exists = await this.app.vault.adapter.exists(path);
    if (exists) await this.app.vault.adapter.remove(path);
  }

  async fork(
    source: FlintSessionMetadata,
    options: { entryId?: string; position?: "before" | "at"; id?: string },
  ): Promise<Session<FlintSessionMetadata>> {
    const sourceSession = await this.open(source);
    let sourceEntries: SessionTreeEntry[];
    if (!options.entryId) {
      sourceEntries = await sourceSession.getEntries();
    } else {
      const target = await sourceSession.getEntry(options.entryId);
      if (!target) {
        throw new SessionError(
          "invalid_fork_target",
          `Entry ${options.entryId} not found`,
        );
      }
      const effectiveLeafId =
        (options.position ?? "before") === "at"
          ? target.id
          : target.type === "message" && target.message.role === "user"
            ? target.parentId
            : undefined;
      if (effectiveLeafId === undefined) {
        throw new SessionError(
          "invalid_fork_target",
          `Entry ${options.entryId} is not a user message`,
        );
      }
      sourceEntries = await sourceSession
        .getStorage()
        .getPathToRoot(effectiveLeafId);
    }
    const forked = await this.create(options);
    for (const entry of sourceEntries) {
      await forked.getStorage().appendEntry(entry);
    }
    return forked;
  }
}
