import type { ExecutionEnv, FileInfo } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  filterVisibleFiles,
  isTextReadable,
  matchVaultPattern,
  validateToolPath,
} from "../guardrails";
import { truncateLine } from "../truncation";
import type { ObsidianTool } from "../types";
import { errorText, listFilesRecursive, text } from "../utils";

const DEFAULT_LIMIT = 100;
const DEFAULT_CONTEXT_LINES = 0;
const MAX_LINE_CHARS = 500;

const parameters = Type.Object({
  pattern: Type.String({
    description:
      "Search pattern: regex by default, or literal string when literal=true.",
  }),
  path: Type.Optional(
    Type.String({
      default: "/",
      description: "File or folder scope. Defaults to vault root.",
    }),
  ),
  glob: Type.Optional(
    Type.String({
      description: 'Filter files by glob pattern, e.g. "*.md" or "**/*.base".',
    }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({
      default: true,
      description: "Case-insensitive search. Default true.",
    }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Treat pattern as a literal string instead of regex.",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      default: DEFAULT_CONTEXT_LINES,
      description: "Number of context lines before and after each match.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      default: DEFAULT_LIMIT,
      description: `Maximum number of matching lines. Default ${DEFAULT_LIMIT}.`,
    }),
  ),
});

export const searchToolDefinition = {
  name: "search",
  label: "Search content",
  description:
    "Search file contents in the vault. Supports regex and literal matching with context lines.",
  promptGuidelines: [
    "Use search to find text across vault files. Prefer search over reading multiple files when looking for specific content.",
    "Use literal=true for exact string matches; otherwise the pattern is treated as a regex.",
  ],
} as const;

interface SearchMatchDetail {
  path: string;
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

interface SearchDetails {
  pattern: string;
  path: string;
  glob?: string;
  ignoreCase: boolean;
  literal: boolean;
  context: number;
  matches: SearchMatchDetail[];
  totalMatches: number;
  searchedFiles: number;
  skippedFiles: number;
  limit: number;
  matchLimitReached?: number;
  linesTruncated: boolean;
}

const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

async function collectSearchFiles(
  env: ExecutionEnv,
  envPath: string,
): Promise<{ ok: true; files: FileInfo[] } | { ok: false; error: string }> {
  if (envPath !== "/") {
    const info = await env.fileInfo(envPath);
    if (!info.ok) return { ok: false, error: info.error.message };
    if (info.value.kind === "file") return { ok: true, files: [info.value] };
  }
  return listFilesRecursive(env, envPath);
}

export function createSearchTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...searchToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const scopePath = params.path ?? "/";
      const validated = validateToolPath(scopePath);
      if (!validated.ok) return errorText(validated.error);

      const limit = params.limit ?? DEFAULT_LIMIT;
      const contextLines = params.context ?? DEFAULT_CONTEXT_LINES;
      const ignoreCase = params.ignoreCase ?? true;
      const literal = params.literal ?? false;

      // Compile regex or prepare literal search.
      let regex: RegExp;
      if (literal) {
        const escaped = params.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, ignoreCase ? "i" : "");
      } else {
        try {
          regex = new RegExp(params.pattern, ignoreCase ? "i" : "");
        } catch (err) {
          return errorText(
            `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const collected = await collectSearchFiles(env, validated.envPath);
      if (!collected.ok) return errorText(collected.error);

      // Filter visible and text-readable.
      const visible = filterVisibleFiles(collected.files);
      const textFiles = visible.filter((entry) => isTextReadable(entry.name));

      // Filter by glob if provided. Obsidian exposes file enumeration, not glob
      // searching, so the env enumerates vault files and matching is applied here.
      const globPattern = params.glob;
      const scopePrefix = validated.vaultPath ? `${validated.vaultPath}/` : "";
      const filtered = globPattern
        ? textFiles.filter((entry) => {
            const relativeToScope =
              scopePrefix && entry.path.startsWith(scopePrefix)
                ? entry.path.slice(scopePrefix.length)
                : entry.path.replace(/^\/+/, "");
            return matchVaultPattern(globPattern, relativeToScope);
          })
        : textFiles;

      let searchedFiles = 0;
      let skippedFiles = 0;
      let totalMatches = 0;
      let linesTruncated = false;
      const matches: SearchMatchDetail[] = [];

      let matchLimitReached = false;

      for (const entry of filtered) {
        if (matches.length >= limit) break;

        let content: string;
        try {
          if ((entry.size ?? 0) > MAX_SEARCH_FILE_BYTES) {
            skippedFiles++;
            continue;
          }
          const readResult = await env.readTextFile(
            `/${entry.path.replace(/^\/+/, "")}`,
          );
          if (!readResult.ok) {
            skippedFiles++;
            continue;
          }
          content = readResult.value;
        } catch {
          skippedFiles++;
          continue;
        }

        searchedFiles++;
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line === undefined || !regex.test(line)) continue;

          totalMatches++;
          if (matches.length >= limit) continue;

          const { text: matchText, truncated } = truncateLine(
            line,
            MAX_LINE_CHARS,
          );
          if (truncated) linesTruncated = true;

          const match: SearchMatchDetail = {
            path: `/${entry.path.replace(/^\/+/, "")}`,
            line: i + 1,
            text: matchText,
          };

          if (contextLines > 0) {
            const beforeStart = Math.max(0, i - contextLines);
            match.before = lines
              .slice(beforeStart, i)
              .map((l) => truncateLine(l, MAX_LINE_CHARS).text);

            const afterEnd = Math.min(lines.length, i + contextLines + 1);
            match.after = lines
              .slice(i + 1, afterEnd)
              .map((l) => truncateLine(l, MAX_LINE_CHARS).text);
          }

          matches.push(match);
          if (matches.length >= limit) {
            matchLimitReached = true;
          }
        }
      }

      // Build content in Pi grep format.
      let contentLines: string[];

      if (contextLines > 0 && matches.length > 0) {
        // With context: show surrounding lines with separators.
        const displayPath = (p: string) => p.replace(/^\//, "");
        contentLines = [];
        for (const match of matches) {
          if (match.before) {
            for (let j = 0; j < match.before.length; j++) {
              const ctxLineNum = match.line - match.before.length + j;
              contentLines.push(
                `${displayPath(match.path)}-${ctxLineNum}- ${match.before[j]}`,
              );
            }
          }
          contentLines.push(
            `${displayPath(match.path)}:${match.line}: ${match.text}`,
          );
          if (match.after) {
            for (let j = 0; j < match.after.length; j++) {
              const ctxLineNum = match.line + j + 1;
              contentLines.push(
                `${displayPath(match.path)}-${ctxLineNum}- ${match.after[j]}`,
              );
            }
          }
        }
      } else {
        contentLines = matches.map(
          (m) => `${m.path.replace(/^\//, "")}:${m.line}: ${m.text}`,
        );
      }

      let content = contentLines.join("\n") || "No matches found";

      // Add limit notice.
      if (matchLimitReached) {
        content += `\n[${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern]`;
      }

      // Add truncation notice.
      if (linesTruncated) {
        content +=
          "\n[Some lines truncated to 500 chars. Use read to see full lines]";
      }

      return text(content, {
        pattern: params.pattern,
        path: validated.envPath,
        glob: params.glob,
        ignoreCase,
        literal,
        context: contextLines,
        matches,
        totalMatches,
        searchedFiles,
        skippedFiles,
        limit,
        matchLimitReached: matchLimitReached ? limit : undefined,
        linesTruncated,
      } satisfies SearchDetails);
    },

    renderTitle(label, args) {
      return `${label}: \`${args.pattern}\``;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "pi-chat-tool-section-title",
          text: "Searching…",
        });
        return;
      }
      if (ctx.status === "error") {
        const msg =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        const section = el.createDiv("pi-chat-tool-section");
        section.createDiv({
          cls: "pi-chat-tool-section-title",
          text: "Error",
        });
        section.createEl("pre", { cls: "is-error", text: msg });
        return;
      }

      const details = result.details as SearchDetails | undefined;
      const matches = details?.matches;
      if (!matches?.length) {
        el.createDiv({
          cls: "pi-chat-tool-section",
          text: "No matches found",
        });
        return;
      }

      const section = el.createDiv("pi-chat-tool-section");
      const countText = details?.matchLimitReached
        ? `${details.matchLimitReached} of ${details.totalMatches} matches`
        : `${matches.length} match${matches.length === 1 ? "" : "es"}`;
      section.createDiv({
        cls: "pi-chat-tool-section-title",
        text: countText,
      });

      const pre = section.createEl("pre", {
        cls: "pi-chat-tool-search",
      });
      const contentText =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      pre.textContent = contentText;
    },

    renderMarkdown(_args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error**\n\n${codeBlock(msg, "text")}`;
      }

      const details = result.details as SearchDetails | undefined;
      const matches = details?.matches;
      if (!matches?.length) return "_No matches found._";

      const content =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      let out = `**${details?.totalMatches ?? matches.length} match${(details?.totalMatches ?? matches.length) === 1 ? "" : "es"}**`;
      if (details?.matchLimitReached) {
        out += ` (showing ${details.matchLimitReached})`;
      }
      return `${out}\n\n${codeBlock(content, "text")}`;
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
