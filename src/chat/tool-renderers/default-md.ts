import { safeJson } from "@/settings/types";

/**
 * Default markdown renderer for tool callouts.
 * Replicates the current export behavior: Arguments code block + Result code block.
 */

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

/** Default markdown export for a tool call body. */
export function defaultRenderMarkdown(
  _label: string,
  args: unknown,
  result: unknown | undefined,
  status: "running" | "done" | "error",
): string {
  const chunks = ["**Arguments**", "", codeBlock(safeJson(args ?? {}), "json")];

  if (result !== undefined) {
    const r = result as Record<string, unknown>;
    const content = textContent(r.content);
    chunks.push("", status === "error" ? "**Error**" : "**Result**", "");
    if (content) chunks.push(codeBlock(content, "text"));
    if (r.details !== undefined) {
      chunks.push(
        "",
        "**Details**",
        "",
        codeBlock(safeJson(r.details), "json"),
      );
    }
  } else {
    chunks.push("", "_No tool result was recorded._");
  }

  return chunks.join("\n");
}
