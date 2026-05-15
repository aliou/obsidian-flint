import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type momentFn from "moment";
import { moment } from "obsidian";
import type { ToolRenderAdapter } from "@/harness/tools";
import type { ToolRun } from "@/settings/types";

export interface ConversationMarkdownExportInput {
  messages: AgentMessage[];
  toolRuns: Map<string, ToolRun>;
  toolsByName: Map<string, ToolRenderAdapter>;
  sessionId: string;
  sessionPath: string;
  exportedAt: Date;
  includeReasoning?: boolean;
  includeToolCalls?: boolean;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string")
        return record.text;
      if (record.type === "image" && typeof record.mimeType === "string")
        return `[Image: ${record.mimeType}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(key: string, values: string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

function messageDate(message: AgentMessage): Date | undefined {
  if (!("timestamp" in message)) return undefined;
  const timestamp = message.timestamp;
  const date =
    typeof timestamp === "number"
      ? new Date(timestamp)
      : typeof timestamp === "string"
        ? new Date(timestamp)
        : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date;
}

function modelsUsed(messages: AgentMessage[]): string[] {
  return Array.from(
    new Set(
      messages
        .map((message) =>
          "model" in message && typeof message.model === "string"
            ? message.model
            : undefined,
        )
        .filter((model): model is string => Boolean(model)),
    ),
  );
}

function sessionBounds(
  messages: AgentMessage[],
  fallback: Date,
): { start: Date; end: Date } {
  const dates = messages.flatMap((message) => {
    const date = messageDate(message);
    return date ? [date] : [];
  });
  if (dates.length === 0) return { start: fallback, end: fallback };
  return {
    start: new Date(Math.min(...dates.map((date) => date.getTime()))),
    end: new Date(Math.max(...dates.map((date) => date.getTime()))),
  };
}

function frontmatter(input: ConversationMarkdownExportInput): string {
  const { start, end } = sessionBounds(input.messages, input.exportedAt);
  const lines = [
    "---",
    ...yamlList("models", modelsUsed(input.messages)),
    `start_datetime: ${yamlString(start.toISOString())}`,
    `end_datetime: ${yamlString(end.toISOString())}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function formatLocalTime(timestamp: unknown): string {
  const date =
    typeof timestamp === "number"
      ? new Date(timestamp)
      : typeof timestamp === "string"
        ? new Date(timestamp)
        : undefined;
  if (!date || Number.isNaN(date.getTime())) return "";
  const obsidianMoment = moment as unknown as typeof momentFn;
  return obsidianMoment(date).format("HH:mm");
}

function normalizeAssistantMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const output: string[] = [];
  let inFence = false;
  let fenceMarker: string | undefined;

  for (const raw of trimmed.split("\n")) {
    const line = raw.trimEnd();
    const fenceMatch = line.trim().match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        inFence = false;
        fenceMarker = undefined;
      }
      output.push(line);
      continue;
    }

    if (!inFence && line.trimStart().startsWith("|")) {
      if (
        output.length > 0 &&
        output[output.length - 1]?.trim() !== "" &&
        !output[output.length - 1]?.trimStart().startsWith("|")
      ) {
        output.push("");
      }
      output.push(line);
      continue;
    }

    if (!inFence && /^\*\*[^*][^\n]*\*\*\s*$/.test(line.trim())) {
      if (output.length > 0 && output[output.length - 1]?.trim() !== "")
        output.push("");
      output.push(line);
      output.push("");
      continue;
    }

    output.push(line);
  }

  const collapsed: string[] = [];
  let blanks = 0;
  let previousWasTable = false;
  for (const line of output) {
    const isTable = line.trimStart().startsWith("|");
    if (line.trim() === "") {
      if (previousWasTable) continue;
      blanks += 1;
      if (blanks <= 2) collapsed.push("");
    } else {
      blanks = 0;
      collapsed.push(line);
    }
    previousWasTable = isTable;
  }
  return collapsed.join("\n").trim();
}

function fenceFor(text: string): string {
  let maxTicks = 2;
  for (const match of text.matchAll(/`+/g)) {
    maxTicks = Math.max(maxTicks, match[0].length);
  }
  return "`".repeat(maxTicks + 1);
}

function codeBlock(text: string, lang = ""): string {
  const fence = fenceFor(text);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function compactArgValue(value: unknown): unknown {
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
  }
  if (Array.isArray(value)) {
    const head = value.slice(0, 5).map(compactArgValue);
    return value.length > 5 ? [...head, "..."] : head;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 6)
        .map(([key, item]) => [key, compactArgValue(item)]),
    );
  }
  return value;
}

function toolTitle(name: string, args: unknown): string {
  return `${name} ${JSON.stringify(compactArgValue(args ?? {}))}`.replace(
    /[[\]]/g,
    (match) => `\\${match}`,
  );
}

function callout(type: string, title: string, body: string): string {
  const safeTitle = title.replace(/\s+/g, " ").trim();
  const lines = [`> [!${type}]- ${safeTitle}`];
  if (body.trim()) {
    for (const line of body.split("\n")) lines.push(`> ${line}`);
  }
  return lines.join("\n");
}

function toolBody(
  args: unknown,
  run: ToolRun | undefined,
  adapter: ToolRenderAdapter | undefined,
): string {
  const status = run?.status ?? "running";
  if (adapter) {
    return adapter.renderMarkdown(args, run?.result, status);
  }
  // Default fallback (same as before)
  const chunks = ["**Arguments**", "", codeBlock(safeJson(args ?? {}), "json")];
  if (run?.result !== undefined) {
    const result = run.result as Record<string, unknown>;
    const content = textContent(result.content);
    chunks.push("", "**Result**", "");
    if (content) chunks.push(codeBlock(content, "text"));
    if (result.details !== undefined) {
      chunks.push(
        "",
        "**Details**",
        "",
        codeBlock(safeJson(result.details), "json"),
      );
    }
  } else {
    chunks.push("", "_No tool result was recorded._");
  }
  return chunks.join("\n");
}

function toolCallout(
  part: Record<string, unknown>,
  run: ToolRun | undefined,
  toolsByName: Map<string, ToolRenderAdapter>,
): string {
  const name =
    typeof part.name === "string" ? part.name : (run?.name ?? "tool");
  const args = part.arguments ?? run?.args ?? {};
  const status = run?.status ?? "running";
  const type =
    status === "error"
      ? "flint-tool-error"
      : status === "done"
        ? "flint-tool-success"
        : "flint-tool-running";
  const adapter = toolsByName.get(name);
  const title = adapter
    ? adapter.renderTitle(args, status)
    : toolTitle(name, args);
  return callout(type, title, toolBody(args, run, adapter));
}

function indentCallout(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function toolsCallout(toolBlocks: string[], failed: number): string {
  const title = `Tool calls (${toolBlocks.length}${failed > 0 ? `, ${failed} failed` : ""})`;
  return callout(
    "flint-tools",
    title,
    toolBlocks.map(indentCallout).join("\n>\n"),
  );
}

function assistantName(message: AgentMessage): string {
  if ("model" in message && typeof message.model === "string")
    return message.model;
  return "Assistant";
}

export function buildConversationMarkdown(
  input: ConversationMarkdownExportInput,
): string {
  const exportedAt = input.exportedAt.toISOString();
  const sessionId = input.sessionId || "unknown-session";
  const includeReasoning = input.includeReasoning ?? true;
  const includeToolCalls = input.includeToolCalls ?? true;
  const markdown: string[] = [
    frontmatter(input),
    "# Flint Conversation Export",
    "",
    `<div class="flint-export-session-meta">Session <code>${sessionId}</code> · exported ${exportedAt}</div>`,
    "",
  ];

  let firstMessage = true;
  for (const message of input.messages) {
    if (message.role === "toolResult") continue;

    if (message.role === "user") {
      if (!firstMessage) markdown.push("", "---", "");
      firstMessage = false;
      markdown.push(
        `<div class="flint-export-role flint-export-user">You · ${formatLocalTime(message.timestamp)}</div>`,
        "",
        normalizeAssistantMarkdown(textContent(message.content)) ||
          "_No text content._",
        "",
      );
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      firstMessage = false;
      markdown.push(
        `<div class="flint-export-role flint-export-assistant">${assistantName(message)} · ${formatLocalTime(message.timestamp)}</div>`,
        "",
      );
      const toolBlocks: string[] = [];
      let failed = 0;
      let emitted = false;
      for (const part of message.content) {
        if (!part || typeof part !== "object") continue;
        const record = part as unknown as Record<string, unknown>;
        if (record.type === "text" && typeof record.text === "string") {
          const text = normalizeAssistantMarkdown(record.text);
          if (text) {
            markdown.push(text, "");
            emitted = true;
          }
        } else if (
          includeReasoning &&
          record.type === "thinking" &&
          typeof record.thinking === "string"
        ) {
          markdown.push(
            callout("flint-reasoning", "Reasoning", record.thinking.trim()),
            "",
          );
          emitted = true;
        } else if (
          includeToolCalls &&
          record.type === "toolCall" &&
          typeof record.id === "string"
        ) {
          const run = input.toolRuns.get(record.id);
          if (run?.status === "error") failed += 1;
          toolBlocks.push(toolCallout(record, run, input.toolsByName));
          emitted = true;
        }
      }
      if (toolBlocks.length > 0)
        markdown.push(toolsCallout(toolBlocks, failed), "");
      if (!emitted) markdown.push("_No visible assistant content._", "");
      if (message.errorMessage) {
        markdown.push(
          callout(
            "flint-tool-error",
            "Assistant error",
            codeBlock(message.errorMessage, "text"),
          ),
          "",
        );
      }
      continue;
    }

    if (!firstMessage) markdown.push("", "---", "");
    firstMessage = false;
    markdown.push(
      `<div class="flint-export-role">${message.role} · ${"timestamp" in message ? formatLocalTime(message.timestamp) : ""}</div>`,
      "",
      codeBlock(safeJson(message), "json"),
      "",
    );
  }

  return `${markdown.join("\n").trim()}\n`;
}
