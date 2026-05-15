import type { ToolRenderContext } from "./tool-render-context";
import type { ObsidianTool } from "./types";

export type { ToolRenderContext };

/** Erased adapter for runtime lookup by tool name. All methods are always present. */
export interface ToolRenderAdapter {
  renderTitle(args: unknown, status: "running" | "done" | "error"): string;
  renderBody(
    el: HTMLElement,
    args: unknown,
    result: unknown | undefined,
    ctx: ToolRenderContext,
  ): void;
  renderMarkdown(
    args: unknown,
    result: unknown | undefined,
    status: "running" | "done" | "error",
  ): string;
}

/** Default implementations injected at adapter construction. */
export interface ToolRenderDefaults {
  renderTitle: (
    label: string,
    args: unknown,
    status: "running" | "done" | "error",
  ) => string;
  renderBody: (
    el: HTMLElement,
    label: string,
    args: unknown,
    result: unknown | undefined,
    ctx: ToolRenderContext,
  ) => void;
  renderMarkdown: (
    label: string,
    args: unknown,
    result: unknown | undefined,
    status: "running" | "done" | "error",
  ) => string;
}

type AnyRenderTitle = (
  label: string,
  args: unknown,
  status: "running" | "done" | "error",
) => string;
type AnyRenderBody = (
  el: HTMLElement,
  args: unknown,
  result: unknown | undefined,
  ctx: ToolRenderContext,
) => void;
type AnyRenderMarkdown = (
  args: unknown,
  result: unknown | undefined,
  status: "running" | "done" | "error",
) => string;

/**
 * Wrap an ObsidianTool into a ToolRenderAdapter.
 * Custom renderers on the tool take priority; missing ones fall back to defaults.
 * Generic types are erased at the adapter boundary; each tool narrows internally.
 */
export function toRenderAdapter(
  tool: ObsidianTool,
  defaults: ToolRenderDefaults,
): ToolRenderAdapter {
  // Capture the custom renderers as erased function types.
  // This avoids non-null assertions inside the closures.
  const titleFn = tool.renderTitle as AnyRenderTitle | undefined;
  const bodyFn = tool.renderBody as AnyRenderBody | undefined;
  const mdFn = tool.renderMarkdown as AnyRenderMarkdown | undefined;
  const label = tool.label;

  return {
    renderTitle: titleFn
      ? (args, status) => {
          try {
            return titleFn(label, args, status);
          } catch (error) {
            console.warn(
              `Failed to render title for tool ${tool.name}:`,
              error,
            );
            return defaults.renderTitle(label, args, status);
          }
        }
      : (args, status) => defaults.renderTitle(label, args, status),
    renderBody: bodyFn
      ? (el, args, result, ctx) => bodyFn(el, args, result, ctx)
      : (el, args, result, ctx) =>
          defaults.renderBody(el, label, args, result, ctx),
    renderMarkdown: mdFn
      ? (args, result, status) => mdFn(args, result, status)
      : (args, result, status) =>
          defaults.renderMarkdown(label, args, result, status),
  };
}
