import type { App, Component } from "obsidian";

/** Context passed to tool DOM renderers. */
export interface ToolRenderContext {
  app: App;
  /** The ItemView, for MarkdownRenderer lifecycle management. */
  component: Component;
  status: "running" | "done" | "error";
  isMobile: boolean;
}
