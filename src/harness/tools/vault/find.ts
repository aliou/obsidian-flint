import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  type FileKind,
  filterVisibleFiles,
  kindForFile,
  matchVaultPattern,
  validateToolPath,
} from "../guardrails";
import type { ObsidianTool } from "../types";
import { errorText, listEntriesRecursive, text } from "../utils";

const DEFAULT_LIMIT = 1000;

const parameters = Type.Object({
  pattern: Type.String({
    description:
      "Glob pattern or substring to match against file/folder names and paths. Supports *, **, and ?.",
  }),
  path: Type.Optional(
    Type.String({
      default: "/",
      description: "Folder scope to search within. Defaults to vault root.",
    }),
  ),
  type: Type.Optional(
    Type.Union(
      ["all", "file", "folder", "note", "base"].map((t) => Type.Literal(t)),
      {
        default: "all",
        description:
          'Filter by entry type: "all", "file", "folder", "note", or "base".',
      },
    ),
  ),
  limit: Type.Optional(
    Type.Number({
      default: DEFAULT_LIMIT,
      description: `Maximum number of results. Default ${DEFAULT_LIMIT}.`,
    }),
  ),
});

export const findToolDefinition = {
  name: "find",
  label: "Find files",
  description:
    "Find files and folders in the vault by name, path, or glob pattern.",
  promptGuidelines: [
    "Use find when you need to locate files by name or pattern, such as all .base files or notes matching a keyword.",
  ],
} as const;

type FindType = "all" | "file" | "folder" | "note" | "base";

interface FindMatchDetail {
  path: string;
  kind: FileKind;
  name: string;
}

interface FindDetails {
  pattern: string;
  path: string;
  type: FindType;
  matches: FindMatchDetail[];
  total: number;
  limit: number;
  resultLimitReached?: number;
}

function entryMatchesType(kind: FileKind, type: FindType): boolean {
  if (type === "all") return true;
  if (type === "file") return kind !== "folder";
  if (type === "folder") return kind === "folder";
  return kind === type;
}

export function createFindTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...findToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const scopePath = params.path ?? "/";
      const validated = validateToolPath(scopePath);
      if (!validated.ok) return errorText(validated.error);

      const limit = params.limit ?? DEFAULT_LIMIT;
      const type = params.type ?? "all";
      const pattern = params.pattern;

      // Obsidian exposes file/folder enumeration through the vault API, not a
      // glob API. The execution env wraps that vault access, so we enumerate via
      // env and apply Pi/fd-style matching here.
      const listed = await listEntriesRecursive(env, validated.envPath);
      if (!listed.ok) return errorText(listed.error);

      // Filter visible (no dot entries).
      const visible = filterVisibleFiles(listed.entries);

      const scopePrefix = validated.vaultPath ? `${validated.vaultPath}/` : "";

      // Match pattern relative to the requested scope.
      const matched = visible.filter((entry) => {
        const entryPath = entry.path.replace(/^\/+/, "");
        const relativeToScope =
          scopePrefix && entryPath.startsWith(scopePrefix)
            ? entryPath.slice(scopePrefix.length)
            : entryPath;
        if (!matchVaultPattern(pattern, relativeToScope)) return false;
        const kind = kindForFile(entry);
        return entryMatchesType(kind, type);
      });

      // Sort alphabetically.
      matched.sort((a, b) => a.path.localeCompare(b.path));

      // Apply limit.
      const total = matched.length;
      const limited = matched.slice(0, limit);
      const resultLimitReached = total > limit ? limit : undefined;

      const matches: FindMatchDetail[] = limited.map((entry) => ({
        path: `/${entry.path.replace(/^\/+/, "")}`,
        kind: kindForFile(entry),
        name: entry.name,
      }));

      // Content: one path per line, relative (no leading slash).
      let content = matches.map((m) => m.path.replace(/^\//, "")).join("\n");

      if (!content) {
        content = "No files found matching pattern";
      } else if (resultLimitReached !== undefined) {
        content += `\n[${limit} results limit reached. Use limit=${limit * 2} for more, or refine pattern]`;
      }

      return text(content, {
        pattern,
        path: validated.envPath,
        type,
        matches,
        total,
        limit,
        resultLimitReached,
      } satisfies FindDetails);
    },

    renderTitle(label, args) {
      return `${label}: \`${args.pattern}\``;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Searching…",
        });
        return;
      }
      if (ctx.status === "error") {
        const msg =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        const section = el.createDiv("flint-chat-tool-section");
        section.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Error",
        });
        section.createEl("pre", { cls: "is-error", text: msg });
        return;
      }

      const details = result.details as FindDetails | undefined;
      const matches = details?.matches;
      if (!matches?.length) {
        el.createDiv({
          cls: "flint-chat-tool-section",
          text: "No files found",
        });
        return;
      }

      const section = el.createDiv("flint-chat-tool-section");
      const countText =
        details?.resultLimitReached !== undefined
          ? `${details.resultLimitReached} of ${details.total} results`
          : `${matches.length} result${matches.length === 1 ? "" : "s"}`;
      section.createDiv({
        cls: "flint-chat-tool-section-title",
        text: countText,
      });

      const list = section.createDiv("flint-chat-tool-list");
      for (const match of matches) {
        const row = list.createDiv("flint-chat-tool-list-entry");
        row.createSpan({
          cls: `flint-chat-tool-list-badge is-${match.kind}`,
          text: match.kind,
        });
        row.createSpan({
          cls: "flint-chat-tool-list-path",
          text: match.path,
        });
      }
    },

    renderMarkdown(_args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error**\n\n${codeBlock(msg, "text")}`;
      }

      const details = result.details as FindDetails | undefined;
      const matches = details?.matches;
      if (!matches?.length) return "_No files found._";

      const lines = matches.map((m) => `- \`${m.kind}\` ${m.path}`);
      let out = `**${details?.total ?? matches.length} result${(details?.total ?? matches.length) === 1 ? "" : "s"}**`;
      if (details?.resultLimitReached !== undefined) {
        out += ` (showing ${details.resultLimitReached})`;
      }
      return `${out}\n\n${lines.join("\n")}`;
    },
  };
}

function codeBlock(text: string, lang = ""): string {
  let maxTicks = 2;
  for (const match of text.matchAll(/`+/g)) {
    maxTicks = Math.max(maxTicks, match[0].length);
  }
  const fence = "`".repeat(maxTicks + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}
