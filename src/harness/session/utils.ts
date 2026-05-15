import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { type App, normalizePath } from "obsidian";

export function now(): string {
  return new Date().toISOString();
}

export function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function updateLabelCache(
  labelsById: Map<string, string>,
  entry: SessionTreeEntry,
): void {
  if (entry.type !== "label") return;
  const label = entry.label?.trim();
  if (label) labelsById.set(entry.targetId, label);
  else labelsById.delete(entry.targetId);
}

export async function ensureParentDirs(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/").slice(0, -1).filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const exists = await app.vault.adapter.exists(current);
    if (!exists) await app.vault.adapter.mkdir(current);
  }
}
