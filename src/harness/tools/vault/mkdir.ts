import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  blockedPathMessage,
  isBlockedVaultPath,
  validateToolPath,
} from "../guardrails";
import type { ObsidianTool } from "../types";
import { errorText, pathDisplayName, text } from "../utils";

const parameters = Type.Object({
  path: Type.String({
    description:
      "Vault-relative folder path to create, such as /Projects/New Folder.",
  }),
});

export const mkdirToolDefinition = {
  name: "mkdir",
  label: "Create folder",
  description:
    "Create a folder in the Obsidian vault. Parent folders are created automatically.",
  promptGuidelines: [
    "Use mkdir before creating several notes in a new folder.",
  ],
} as const;

interface MkdirDetails {
  path: string;
  created: boolean;
}

export function createMkdirTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...mkdirToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const validated = validateToolPath(params.path);
      if (!validated.ok) return errorText(validated.error);

      // Block dot paths.
      if (isBlockedVaultPath(validated.envPath)) {
        return errorText(blockedPathMessage(validated.envPath));
      }

      // Check if folder already exists.
      const existsResult = await env.exists(validated.envPath);
      if (!existsResult.ok) return errorText(existsResult.error.message);

      if (existsResult.value) {
        return text(`Folder already exists: ${validated.displayPath}`, {
          path: validated.envPath,
          created: false,
        } satisfies MkdirDetails);
      }

      const result = await env.createDir(validated.envPath, {
        recursive: true,
      });
      if (!result.ok) return errorText(result.error.message, result.error);

      return text(`Created folder ${validated.displayPath}`, {
        path: validated.envPath,
        created: true,
      } satisfies MkdirDetails);
    },

    renderTitle(label, args) {
      return `${label}: \`${pathDisplayName(args.path)}\``;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "pi-chat-tool-section-title",
          text: "Creating…",
        });
        return;
      }
      const msg =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as MkdirDetails | undefined;
      const section = el.createDiv("pi-chat-tool-section");

      if (ctx.status === "error") {
        section.createDiv({
          cls: "pi-chat-tool-section-title",
          text: "Error",
        });
        section.createEl("pre", { cls: "is-error", text: msg });
        return;
      }

      const row = section.createDiv("pi-chat-tool-list-entry");
      row.createSpan({
        cls: `pi-chat-tool-list-badge is-${details?.created ? "created" : "existing"}`,
        text: details?.created ? "created" : "existing",
      });
      row.createSpan({
        cls: "pi-chat-tool-list-path",
        text: details?.path ?? _args.path,
      });
    },

    renderMarkdown(args, result, status) {
      if (!result) return `**\`${args.path}\`** — _creating…_`;
      const msg =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      if (status === "error")
        return `**Error creating \`${args.path}\`**\n\n${codeBlock(msg, "text")}`;
      return `**${msg}**`;
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
