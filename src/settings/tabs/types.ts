import type { App } from "obsidian";
import type FlintPlugin from "@/main";

export type SettingsPageId =
  | "chat"
  | "skills"
  | "tools"
  | "exports"
  | "advanced"
  | "providers";

export type SettingsTabContext = {
  app: App;
  plugin: FlintPlugin;
  display(): void;
  notice(error: unknown): void;
  renderPageHeader(containerEl: HTMLElement, description: string): void;
};
