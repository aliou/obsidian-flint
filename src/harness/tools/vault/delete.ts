import type { ExecutionEnv } from "@earendil-works/pi-agent-core";
import type { App } from "obsidian";
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
      "Vault-relative path of the file or folder to delete, such as /Notes/Old.md.",
  }),
});

export const deleteToolDefinition = {
  name: "delete",
  label: "Move to trash",
  description:
    "Move a file or folder to trash in the Obsidian vault. Uses the user's preferred trash behavior.",
  promptGuidelines: [
    "Only use delete when the user explicitly asks to delete a file or folder.",
    "delete moves items to trash, it does not permanently delete. Mention the target path clearly before or after deleting.",
  ],
} as const;

interface DeleteDetails {
  path: string;
  trashed: boolean;
  method: string;
}

export function createDeleteTool(
  env: ExecutionEnv,
  app: App,
): ObsidianTool<typeof parameters> {
  return {
    ...deleteToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const validated = validateToolPath(params.path);
      if (!validated.ok) return errorText(validated.error);

      // Block dot paths.
      if (isBlockedVaultPath(validated.envPath)) {
        return errorText(blockedPathMessage(validated.envPath));
      }

      // Check the item exists.
      const existsResult = await env.exists(validated.envPath);
      if (!existsResult.ok) return errorText(existsResult.error.message);
      if (!existsResult.value) {
        return errorText(`Path not found: ${validated.displayPath}`);
      }

      // Use Obsidian's FileManager.trashFile for user's preferred trash behavior.
      const abstractFile = app.vault.getAbstractFileByPath(validated.vaultPath);
      if (!abstractFile) {
        return errorText(`Path not found: ${validated.displayPath}`);
      }

      try {
        await app.fileManager.trashFile(abstractFile);
        return text(`Moved ${validated.displayPath} to trash`, {
          path: validated.envPath,
          trashed: true,
          method: "fileManager.trashFile",
        } satisfies DeleteDetails);
      } catch (err) {
        return errorText(err instanceof Error ? err.message : String(err), {
          path: validated.envPath,
        });
      }
    },

    renderTitle(label, args) {
      return `${label}: \`${pathDisplayName(args.path)}\``;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({
          cls: "flint-chat-tool-section-title",
          text: "Moving to trash…",
        });
        return;
      }

      const section = el.createDiv("flint-chat-tool-section");
      section.createDiv({
        cls: "flint-chat-tool-section-title",
        text: ctx.status === "error" ? "Error" : "Trashed",
      });

      if (ctx.status === "error") {
        const msg =
          result.content[0]?.type === "text" ? result.content[0].text : "";
        section.createEl("pre", { cls: "is-error", text: msg });
        return;
      }

      const details = result.details as DeleteDetails | undefined;
      const row = section.createDiv("flint-chat-tool-list-entry");
      row.createSpan({
        cls: "flint-chat-tool-list-badge is-trashed",
        text: "trashed",
      });
      row.createSpan({
        cls: "flint-chat-tool-list-path",
        text: details?.path ?? _args.path,
      });
    },

    renderMarkdown(args, result, status) {
      if (!result) return `**\`${args.path}\`** — _moving to trash…_`;
      const msg =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      if (status === "error")
        return `**Error deleting \`${args.path}\`**\n\n${codeBlock(msg, "text")}`;
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
