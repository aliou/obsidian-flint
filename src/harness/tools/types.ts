import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import type { ToolRenderContext } from "./tool-render-context";

export interface ObsidianTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends AgentTool<TParameters, TDetails> {
  /** Tool-specific usage guidelines injected into the system prompt. */
  promptGuidelines?: readonly string[];

  /** Return a markdown string for the tool call title (collapsed row and export callout title). */
  renderTitle?(
    label: string,
    args: Static<TParameters>,
    status: "running" | "done" | "error",
  ): string;

  /** Populate the expanded body area. result is undefined when the tool is still running. */
  renderBody?(
    el: HTMLElement,
    args: Static<TParameters>,
    result: AgentToolResult<TDetails> | undefined,
    ctx: ToolRenderContext,
  ): void;

  /** Return markdown for the export callout body. */
  renderMarkdown?(
    args: Static<TParameters>,
    result: AgentToolResult<TDetails> | undefined,
    status: "running" | "done" | "error",
  ): string;
}
