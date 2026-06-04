import type {
  LeafEntry,
  SessionStorage,
  SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { SessionError } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
import type { FlintSessionMetadata } from "./types";
import { ensureParentDirs, now, shortId, updateLabelCache } from "./utils";

export class ObsidianJsonlSessionStorage
  implements SessionStorage<FlintSessionMetadata>
{
  private entries: SessionTreeEntry[] = [];
  private byId = new Map<string, SessionTreeEntry>();
  private labelsById = new Map<string, string>();
  private leafId: string | null = null;

  private constructor(
    private readonly app: App,
    private readonly path: string,
    private readonly metadata: FlintSessionMetadata,
  ) {}

  static async create(
    app: App,
    path: string,
    sessionId: string,
  ): Promise<ObsidianJsonlSessionStorage> {
    const metadata = { id: sessionId, createdAt: now(), path };
    await ensureParentDirs(app, path);
    await app.vault.adapter.write(
      path,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: metadata.id,
        timestamp: metadata.createdAt,
      })}\n`,
    );
    return new ObsidianJsonlSessionStorage(app, path, metadata);
  }

  static async open(
    app: App,
    path: string,
  ): Promise<ObsidianJsonlSessionStorage> {
    const content = await app.vault.adapter.read(path);
    const lines = content.split("\n").filter((line) => line.trim());
    if (!lines[0]) throw new Error(`Invalid session file: ${path}`);
    const header = JSON.parse(lines[0]) as {
      id: string;
      createdAt?: string;
      timestamp?: string;
    };
    const storage = new ObsidianJsonlSessionStorage(app, path, {
      id: header.id,
      createdAt: header.timestamp ?? header.createdAt ?? now(),
      path,
    });
    for (const line of lines.slice(1)) {
      try {
        const entry = JSON.parse(line) as SessionTreeEntry;
        storage.entries.push(entry);
        storage.byId.set(entry.id, entry);
        updateLabelCache(storage.labelsById, entry);
        storage.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
      } catch (_) {
        void _;
      }
    }
    return storage;
  }

  async getMetadata(): Promise<FlintSessionMetadata> {
    return this.metadata;
  }

  async getLeafId(): Promise<string | null> {
    return this.leafId;
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId))
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    const entry: LeafEntry = {
      type: "leaf",
      id: await this.createEntryId(),
      parentId: this.leafId,
      timestamp: now(),
      targetId: leafId,
    };
    await this.app.vault.adapter.append(
      this.path,
      `${JSON.stringify(entry)}\n`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = leafId;
  }

  async createEntryId(): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const candidate = shortId();
      if (!this.byId.has(candidate)) return candidate;
    }
    return crypto.randomUUID();
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    await this.app.vault.adapter.append(
      this.path,
      `${JSON.stringify(entry)}\n`,
    );
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    updateLabelCache(this.labelsById, entry);
    this.leafId = entry.type === "leaf" ? entry.targetId : entry.id;
  }

  async getEntry(entryId: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(entryId);
  }

  async findEntries<TType extends SessionTreeEntry["type"]>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> =>
        entry.type === type,
    );
  }

  async getLabel(entryId: string): Promise<string | undefined> {
    return this.labelsById.get(entryId);
  }

  async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return [];
    const path: SessionTreeEntry[] = [];
    let current = this.byId.get(leafId);
    if (!current)
      throw new SessionError("not_found", `Entry ${leafId} not found`);
    while (current) {
      path.unshift(current);
      if (!current.parentId) break;
      const parent = this.byId.get(current.parentId);
      if (!parent)
        throw new SessionError(
          "invalid_session",
          `Entry ${current.parentId} not found`,
        );
      current = parent;
    }
    return path;
  }

  async getEntries(): Promise<SessionTreeEntry[]> {
    return [...this.entries];
  }
}
