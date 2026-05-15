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
      "Vault-relative path of the note to create or overwrite, such as /Notes/Plan.md.",
  }),
  content: Type.String({
    description:
      "Complete file contents to write. Existing content at the path is replaced.",
  }),
});

export const writeToolDefinition = {
  name: "write",
  label: "Write note",
  description:
    "Create or overwrite a text note in the Obsidian vault. Parent folders are created when possible.",
  promptGuidelines: [
    "Use write when the user asks you to create or update a note.",
    "Before using write to overwrite an existing note, use read unless the user explicitly wants replacement content.",
  ],
} as const;

interface WriteDetails {
  path: string;
  created: boolean;
  overwritten: boolean;
  bytes: number;
}

export function createWriteTool(
  env: ExecutionEnv,
): ObsidianTool<typeof parameters> {
  return {
    ...writeToolDefinition,
    parameters,
    async execute(_toolCallId, params) {
      const validated = validateToolPath(params.path);
      if (!validated.ok) return errorText(validated.error);

      // Block dot paths.
      if (isBlockedVaultPath(validated.envPath)) {
        return errorText(blockedPathMessage(validated.envPath));
      }

      // Check if file already exists.
      const existsResult = await env.exists(validated.envPath);
      const alreadyExists = existsResult.ok && existsResult.value;

      const result = await env.writeFile(validated.envPath, params.content);
      if (!result.ok) return errorText(result.error.message, result.error);

      const bytes = new TextEncoder().encode(params.content).byteLength;
      const displayPath = validated.displayPath;

      if (alreadyExists) {
        return text(`Wrote ${displayPath} (updated existing file)`, {
          path: validated.envPath,
          created: false,
          overwritten: true,
          bytes,
        } satisfies WriteDetails);
      }
      return text(`Wrote ${displayPath}`, {
        path: validated.envPath,
        created: true,
        overwritten: false,
        bytes,
      } satisfies WriteDetails);
    },

    renderTitle(label, args) {
      const lines = args.content.split("\n").length;
      return `${label}: \`${pathDisplayName(args.path)}\` (${lines} line${lines === 1 ? "" : "s"})`;
    },

    renderBody(el, _args, result, ctx) {
      if (!result) {
        el.createDiv({ cls: "pi-chat-tool-section-title", text: "Writing…" });
        return;
      }
      const _msg =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as WriteDetails | undefined;
      const section = el.createDiv("pi-chat-tool-section");
      section.createDiv({
        cls: "pi-chat-tool-section-title",
        text: ctx.status === "error" ? "Error" : "Result",
      });

      const row = section.createDiv("pi-chat-tool-list-entry");
      if (details?.overwritten) {
        row.createSpan({
          cls: "pi-chat-tool-list-badge is-updated",
          text: "updated",
        });
      } else if (details?.created) {
        row.createSpan({
          cls: "pi-chat-tool-list-badge is-created",
          text: "created",
        });
      }
      row.createSpan({
        cls: "pi-chat-tool-list-path",
        text: details?.path ?? _args.path,
      });
      if (details?.bytes !== undefined) {
        row.createSpan({
          cls: "pi-chat-tool-list-meta",
          text: `${details.bytes} bytes`,
        });
      }
    },

    renderMarkdown(args, result, status) {
      if (!result) return `**\`${args.path}\`** — _writing…_`;
      const msg =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      if (status === "error")
        return `**Error writing \`${args.path}\`**\n\n${codeBlock(msg, "text")}`;
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
