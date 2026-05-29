import type { Plugin } from "obsidian";
import { installObsidianNodeFetch } from "@/shims/fetch";
import {
  DEFAULT_SETTINGS,
  ensureValidSelection,
  type FlintSettings,
  modelsForProvider,
  normalizeSettings,
} from "./types";

const PREVIOUS_AUTO_AGENT_FILE_PATH = "__agents/AGENTS.md";

export class FlintSettingsStore {
  settings: FlintSettings = DEFAULT_SETTINGS;

  private readonly changeListeners = new Set<() => void>();
  private readonly sessionStoragePathListeners = new Set<
    (path: string) => void
  >();

  constructor(private readonly plugin: Plugin) {}

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    this.settings = normalizeSettings(data);
    await this.clearMissingPreviousAgentDefault();
    ensureValidSelection(this.settings);
    this.refreshFetchPatch();
    await this.save();
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.settings);
  }

  async update(patch: Partial<FlintSettings>): Promise<void> {
    const previousSessionStoragePath = this.settings.sessionStoragePath;
    Object.assign(this.settings, patch);
    await this.save();
    if (this.settings.sessionStoragePath !== previousSessionStoragePath) {
      for (const listener of this.sessionStoragePathListeners) {
        listener(this.settings.sessionStoragePath);
      }
    }
    this.notifyChange();
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onSessionStoragePathChange(listener: (path: string) => void): () => void {
    this.sessionStoragePathListeners.add(listener);
    return () => this.sessionStoragePathListeners.delete(listener);
  }

  notifyChange(): void {
    for (const listener of this.changeListeners) listener();
  }

  refreshFetchPatch(): void {
    const authlessBaseUrls: string[] = [];

    // Custom providers marked as authless.
    for (const provider of this.settings.customProviders) {
      if (provider.requiresApiKey === false)
        authlessBaseUrls.push(provider.baseUrl);
    }

    // Native providers marked as authless via providerAuth.
    for (const [providerId, auth] of Object.entries(
      this.settings.providerAuth,
    )) {
      if (auth.requiresApiKey === false) {
        const models = modelsForProvider(
          this.settings.customProviders,
          providerId,
          this.settings.providerAuth,
        );
        if (models.length > 0 && models[0].baseUrl)
          authlessBaseUrls.push(models[0].baseUrl);
      }
    }

    installObsidianNodeFetch({ authlessBaseUrls });
  }

  private async clearMissingPreviousAgentDefault(): Promise<void> {
    if (this.settings.agentFilePath !== PREVIOUS_AUTO_AGENT_FILE_PATH) return;
    try {
      const stat = await this.plugin.app.vault.adapter.stat(
        PREVIOUS_AUTO_AGENT_FILE_PATH,
      );
      if (stat?.type === "file") return;
    } catch (error) {
      console.debug("Previous default AGENTS.md file not found", error);
    }
    this.settings.agentFilePath = "";
  }
}
