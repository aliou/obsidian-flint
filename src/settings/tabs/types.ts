import type { App } from "obsidian";
import type FlintPlugin from "@/main";

export type SettingsTabContext = {
  app: App;
  plugin: FlintPlugin;
  display(): void;
  notice(error: unknown): void;
  renderPageHeader(containerEl: HTMLElement, description: string): void;
};
