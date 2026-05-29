import type { ExecutionEnv, FileInfo } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  type FileKind,
  filterVisibleEntries,
  kindForFile,
  validateToolPath,
} from "../guardrails";
import type { ObsidianTool } from "../types";
import { errorText, pathDisplayName, text } from "../utils";

const parameters = Type.Object({
  path: Type.String({
    default: "/",
    description:
      "Vault-relative folder path to list. Use / for the vault root.",
  }),
});

export const lsToolDefinition = {
  name: "ls",
  label: "List folder",
  description:
    "List visible contents of a folder in the Obsidian vault. Hidden and system entries are omitted.",
  promptGuidelines: [
    "Use ls to inspect folder contents before reading notes or Bases when the target path is unclear.",
  ],
} as const;

interface LsEntryDetail {
  name: string;
  path: string;
  kind: FileKind;
  ext?: string;
  size?: number;
  mtimeMs?: number;
}

interface LsDetails {
  path: string;
  entries: LsEntryDetail[];
  hiddenCount: number;
}

function toDetails(entries: FileInfo[], _hiddenCount: number): LsEntryDetail[] {
  return entries.map((entry) => {
    const kind = kindForFile(entry);
    return {
      name: entry.name,
      path: `/${entry.path.replace(/^\/+/, "")}`,
      kind,
      ext: entry.name.includes(".") ? entry.name.split(".").pop() : undefined,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
    };
  });
}

function kindLabel(kind: FileKind): string {
  return kind.padEnd(6);
}

export function createLsTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...lsToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const validated = validateToolPath(params.path || "/");
      if (!validated.ok) return errorText(validated.error);

      const result = await env.listDir(validated.envPath);
      if (!result.ok) return errorText(result.error.message, result.error);

      // Filter blocked entries before any processing.
      const visible = filterVisibleEntries(result.value);
      const hiddenCount = result.value.length - visible.length;

      // Sort: folders first, then files, alphabetically within each group.
      const sorted = [...visible].sort((a, b) => {
        const aKind = kindForFile(a);
        const bKind = kindForFile(b);
        if (aKind === "folder" && bKind !== "folder") return -1;
        if (aKind !== "folder" && bKind === "folder") return 1;
        return a.path.localeCompare(b.path);
      });

      const details = toDetails(sorted, hiddenCount);
      const contentLines = details.map(
        (entry) => `${kindLabel(entry.kind)} ${entry.path.replace(/^\//, "")}`,
      );
      const content = contentLines.join("\n") || "(empty)";

      return text(content, {
        path: validated.envPath,
        entries: details,
        hiddenCount,
      } satisfies LsDetails);
    },

    renderTitle(label, args) {
      return `${label}: \`${pathDisplayName(args.path || "/")}\``;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Listing…",
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

      const details = result.details as LsDetails | undefined;
      const entries = details?.entries;
      if (!entries?.length) {
        el.createDiv({ cls: "flint-chat-tool-section", text: "(empty)" });
        return;
      }

      const section = el.createDiv("flint-chat-tool-section");
      const titleParts = [
        `${entries.length} item${entries.length === 1 ? "" : "s"}`,
      ];
      if (details?.hiddenCount) {
        titleParts.push(
          `(${details.hiddenCount} hidden/system ${details.hiddenCount === 1 ? "entry" : "entries"} omitted)`,
        );
      }
      section.createDiv({
        cls: "flint-chat-tool-section-title",
        text: titleParts.join(" "),
      });

      const list = section.createDiv("flint-chat-tool-list");
      for (const entry of entries) {
        const row = list.createDiv("flint-chat-tool-list-entry");
        row.createSpan({
          cls: `flint-chat-tool-list-badge is-${entry.kind}`,
          text: entry.kind,
        });
        row.createSpan({
          cls: "flint-chat-tool-list-path",
          text: entry.path,
        });
      }
    },

    renderMarkdown(args, result, status) {
      if (status === "error" || !result) {
        const msg =
          result?.content[0]?.type === "text"
            ? result.content[0].text
            : "Unknown error";
        return `**Error listing \`${args.path || "/"}\`**\n\n${codeBlock(msg, "text")}`;
      }

      const details = result.details as LsDetails | undefined;
      const entries = details?.entries;
      if (!entries?.length) return `**\`${args.path || "/"}\`** — _empty_`;

      const lines = entries.map((entry) => `- \`${entry.kind}\` ${entry.path}`);
      let out = `**\`${args.path || "/"}\`** — ${entries.length} item${entries.length === 1 ? "" : "s"}`;
      if (details?.hiddenCount) {
        out += ` (${details.hiddenCount} hidden)`;
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
