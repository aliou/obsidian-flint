import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { App, TAbstractFile } from "obsidian";
import { Notice, normalizePath, TFile, TFolder } from "obsidian";
import { buildConversationMarkdown } from "@/export/markdown";
import type { ToolRenderAdapter } from "@/harness/tools";
import type { FlintExportSettings, ToolRun } from "@/settings/types";

export interface ExportConversationOptions {
  app: App;
  messages: AgentMessage[];
  toolRuns: Map<string, ToolRun>;
  toolsByName: Map<string, ToolRenderAdapter>;
  sessionId: string;
  sessionPath: string;
  settings: FlintExportSettings;
}

function pathParts(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path).replace(/^\/+|\/+$/g, "");
  if (!normalized) return;
  let current = "";
  for (const part of pathParts(normalized)) {
    current = current ? `${current}/${part}` : part;
    const existing: TAbstractFile | null =
      app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFolder) continue;
    if (existing instanceof TFile)
      throw new Error(`Export path is a file: ${current}`);
    await app.vault.createFolder(current);
  }
}

function safeFilenamePart(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function uniqueExportPath(
  app: App,
  outputDirectory: string,
  sessionId: string,
  exportedAt: Date,
): Promise<string> {
  const folder = normalizePath(outputDirectory || "Flint Exports").replace(
    /^\/+|\/+$/g,
    "",
  );
  const shortSessionId = safeFilenamePart(sessionId || "session");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const random = crypto.randomUUID().split("-")[0] ?? String(Date.now());
    const filename = `${timestampForFilename(exportedAt)}_${shortSessionId}_${random}.md`;
    const path = normalizePath(folder ? `${folder}/${filename}` : filename);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
  throw new Error("Could not create a unique export filename");
}

export async function exportConversationMarkdown(
  options: ExportConversationOptions,
): Promise<string> {
  if (options.messages.length === 0)
    throw new Error("No conversation to export");
  const exportedAt = new Date();
  const outputDirectory = options.settings.outputDirectory || "Flint Exports";
  await ensureFolder(options.app, outputDirectory);
  const path = await uniqueExportPath(
    options.app,
    outputDirectory,
    options.sessionId,
    exportedAt,
  );
  const markdown = buildConversationMarkdown({
    messages: options.messages,
    toolRuns: options.toolRuns,
    toolsByName: options.toolsByName,
    sessionId: options.sessionId,
    sessionPath: options.sessionPath,
    exportedAt,
    includeReasoning: options.settings.includeReasoning,
    includeToolCalls: options.settings.includeToolCalls,
  });
  await options.app.vault.create(path, markdown);
  const file = options.app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    const leaf = options.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
  }
  new Notice(`Exported conversation to ${path}`);
  return path;
}
