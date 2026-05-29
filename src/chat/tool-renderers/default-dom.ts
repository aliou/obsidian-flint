import type { ToolRenderContext } from "@/harness/tools";
import { safeJson } from "@/settings/types";

/**
 * Extract a compact one-line preview from tool arguments.
 * Checks known argument keys for a representative value.
 */
export function extractArgsPreview(
  _toolName: string,
  args: unknown,
): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const stringKeys = [
    "file_path",
    "path",
    "notebook_path",
    "selector",
    "action",
    "command",
    "url",
  ];
  for (const key of stringKeys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const quotedKeys = ["pattern", "query"];
  for (const key of quotedKeys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return `"${value}"`;
  }
  return null;
}

/** Default title: tool label + args preview. */
export function defaultRenderTitle(
  label: string,
  args: unknown,
  _status: "running" | "done" | "error",
): string {
  const preview = extractArgsPreview(label, args);
  return preview ? `${label}: ${preview}` : label;
}

/** Default body: Arguments JSON + Output JSON (current behavior). */
export function defaultRenderBody(
  el: HTMLElement,
  _label: string,
  args: unknown,
  result: unknown | undefined,
  ctx: ToolRenderContext,
): void {
  if (
    args &&
    typeof args === "object" &&
    Object.keys(args as Record<string, unknown>).length > 0
  ) {
    renderSection(el, "Arguments", safeJson(args));
  }

  if (result !== undefined) {
    const text = typeof result === "string" ? result : safeJson(result);
    const label =
      ctx.status === "running"
        ? "Output (streaming)"
        : ctx.status === "error"
          ? "Error"
          : "Output";
    renderSection(el, label, text, ctx.status === "error");
  }
}

function renderSection(
  parent: HTMLElement,
  label: string,
  text: string,
  isError = false,
): void {
  const section = parent.createDiv("flint-chat-tool-section");
  section.createDiv({ cls: "flint-chat-tool-section-title", text: label });
  section.createEl("pre", { cls: isError ? "is-error" : undefined, text });
}
