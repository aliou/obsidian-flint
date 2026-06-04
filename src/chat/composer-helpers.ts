import {
  type MetadataCache,
  normalizePath,
  type TFile,
  type Vault,
} from "obsidian";

export type SlashCommandSuggestion = {
  command: string;
  label: string;
  description: string;
  kind: "action" | "skill";
};

export type WikiLinkSuggestion = {
  file: TFile;
  target: string;
  label: string;
  directory: string;
};

export type WikiLinkContext = {
  start: number;
  query: string;
};

export function escapeXmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

export function decodeXmlValue(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function splitMiddleText(value: string): { start: string; end: string } {
  const extensionIndex = value.lastIndexOf(".");
  const suffixStart =
    extensionIndex > 4
      ? Math.max(0, extensionIndex - 4)
      : Math.ceil(value.length / 2);
  return {
    start: value.slice(0, suffixStart),
    end: value.slice(suffixStart),
  };
}

export function directoryPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "/" : path.slice(0, index) || "/";
}

export function expandResolvedWikiLinks(
  text: string,
  resolvedWikiLinkPaths: Map<string, string>,
): string {
  if (resolvedWikiLinkPaths.size === 0) return text;
  return text.replace(/\[\[([^\]\n]+)\]\]/gu, (source, label: string) => {
    const path = resolvedWikiLinkPaths.get(label);
    if (!path) return source;
    return `<obsidian-wikilink path="${escapeXmlAttribute(path)}">${escapeXmlText(label)}</obsidian-wikilink>`;
  });
}

export function parseSlashCommand(
  text: string,
):
  | { command: "compact"; args?: string }
  | { command: "reload" }
  | { command: "model" }
  | { command: "name"; args?: string }
  | { command: "skill"; name: string; args?: string }
  | undefined {
  const compactMatch = text.match(/^\/compact(?:\s+([\s\S]*))?$/);
  if (compactMatch) return { command: "compact", args: compactMatch[1] };

  if (/^\/reload$/.test(text)) return { command: "reload" };

  if (/^\/model$/.test(text)) return { command: "model" };

  const nameMatch = text.match(/^\/name(?:\s+([\s\S]+))?$/);
  if (nameMatch) return { command: "name", args: nameMatch[1] };

  const skillMatch = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
  if (skillMatch?.[1]) {
    return { command: "skill", name: skillMatch[1], args: skillMatch[2] };
  }

  return undefined;
}

export function currentWikiLinkContext(
  input: HTMLTextAreaElement | undefined,
): WikiLinkContext | undefined {
  if (!input || input.selectionStart !== input.selectionEnd) return undefined;
  const cursor = input.selectionStart;
  const beforeCursor = input.value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("[[");
  if (start === -1) return undefined;

  const query = beforeCursor.slice(start + 2);
  if (query.includes("]]")) return undefined;
  if (query.includes("\n")) return undefined;
  return { start, query };
}

export function buildWikiLinkSuggestions(
  vault: Vault,
  metadataCache: MetadataCache,
  query: string,
): WikiLinkSuggestion[] {
  const normalized = query.toLowerCase().trim();
  return vault
    .getFiles()
    .filter((file) => {
      if (!normalized) return true;
      return file.path.toLowerCase().includes(normalized);
    })
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 5)
    .map((file) => ({
      file,
      target: metadataCache.fileToLinktext(file, "", file.extension === "md"),
      label: file.name,
      directory: directoryPath(file.path),
    }));
}

export function currentSlashToken(
  input: HTMLTextAreaElement | undefined,
): string | undefined {
  const value = input?.value ?? "";
  const cursor = input?.selectionStart ?? value.length;
  if (cursor !== value.length) return undefined;
  if (value.includes("\n")) return undefined;
  const match = value.match(/^\/\S*$/);
  return match ? value : undefined;
}

export function resolvedVaultPathForWikiLink(file: TFile): string {
  return `/${normalizePath(file.path)}`;
}
