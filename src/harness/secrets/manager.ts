import type { Api, Model } from "@earendil-works/pi-ai";
import { type App, requestUrl } from "obsidian";
import type { FlintSettingsStore } from "@/settings/store";
import {
  type CustomProviderModelConfig,
  createDefaultModelConfig,
} from "@/settings/types";
import { AddSecretModal } from "@/settings/views/add-secret-modal";
import { OBSIDIAN_AUTHLESS_API_KEY } from "@/shims/fetch";

export class SecretManager {
  private onCredentialChange?: () => void;

  constructor(
    private readonly app: App,
    private readonly store: FlintSettingsStore,
  ) {}

  setOnCredentialChange(fn: () => void): void {
    this.onCredentialChange = fn;
  }

  listSecretIds(): string[] {
    return this.app.secretStorage
      .listSecrets()
      .filter((id) => {
        const value = this.app.secretStorage.getSecret(id);
        return value !== null && value.trim().length > 0;
      })
      .sort((a, b) => a.localeCompare(b));
  }

  getProviderSecretId(provider: string): string | undefined {
    const custom = this.store.settings.customProviders.find(
      (candidate) => candidate.id === provider,
    );
    if (custom) return custom.secretId;
    return this.store.settings.providerAuth[provider]?.secretId;
  }

  providerRequiresApiKey(provider: string): boolean {
    const customProvider = this.store.settings.customProviders.find(
      (candidate) => candidate.id === provider,
    );
    if (customProvider) return customProvider.requiresApiKey !== false;
    return this.store.settings.providerAuth[provider]?.requiresApiKey ?? true;
  }

  hasCredential(provider: string): boolean {
    if (!this.providerRequiresApiKey(provider)) return true;
    const secretId = this.getProviderSecretId(provider);
    if (!secretId) return false;
    const secret = this.app.secretStorage.getSecret(secretId);
    return secret !== null && secret.trim().length > 0;
  }

  async setProviderAuth(
    provider: string,
    auth: { requiresApiKey: boolean; secretId?: string },
  ): Promise<void> {
    const customIndex = this.store.settings.customProviders.findIndex(
      (candidate) => candidate.id === provider,
    );
    if (customIndex >= 0) {
      this.store.settings.customProviders[customIndex] = {
        ...this.store.settings.customProviders[customIndex],
        requiresApiKey: auth.requiresApiKey,
        secretId: auth.secretId,
      };
    } else {
      this.store.settings.providerAuth[provider] = {
        requiresApiKey: auth.requiresApiKey,
        secretId: auth.secretId,
      };
    }
    this.store.refreshFetchPatch();
    await this.store.save();
    this.store.notifyChange();
    this.onCredentialChange?.();
  }

  openAddSecretModal(onSaved: (secretId: string) => void): void {
    new AddSecretModal(this.app, onSaved).open();
  }

  async discoverOpenAIModels(
    baseUrl: string,
    secretId?: string,
  ): Promise<CustomProviderModelConfig[]> {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (!normalizedBaseUrl) throw new Error("Base URL is required");
    const apiKey = secretId
      ? this.app.secretStorage.getSecret(secretId)?.trim() || undefined
      : undefined;
    const response = await requestUrl({
      url: `${normalizedBaseUrl}/models`,
      method: "GET",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      throw: false,
    });
    if (response.status >= 400)
      throw new Error(`${response.status}: ${response.text}`);

    const rawModels = Array.isArray(response.json?.data)
      ? response.json.data
      : Array.isArray(response.json)
        ? response.json
        : [];
    const models = rawModels
      .map((entry: unknown): CustomProviderModelConfig | undefined => {
        if (typeof entry === "string")
          return createDefaultModelConfig(entry, entry);
        if (!entry || typeof entry !== "object") return undefined;
        const record = entry as Record<string, unknown>;
        if (typeof record.id !== "string") return undefined;
        return createDefaultModelConfig(
          record.id,
          typeof record.name === "string" ? record.name : record.id,
        );
      })
      .filter(
        (
          model: CustomProviderModelConfig | undefined,
        ): model is CustomProviderModelConfig => Boolean(model),
      );
    const byId = new Map<string, CustomProviderModelConfig>(
      models.map((model: CustomProviderModelConfig) => [model.id, model]),
    );
    return Array.from(byId.values()).sort(
      (a: CustomProviderModelConfig, b: CustomProviderModelConfig) =>
        a.id.localeCompare(b.id),
    );
  }

  resolveCredential(
    model: Model<Api>,
  ): Promise<{ apiKey: string; headers?: Record<string, string> } | undefined> {
    if (!this.providerRequiresApiKey(model.provider))
      return Promise.resolve({ apiKey: OBSIDIAN_AUTHLESS_API_KEY });
    const secretId = this.getProviderSecretId(model.provider);
    if (!secretId) return Promise.resolve(undefined);
    const secret = this.app.secretStorage.getSecret(secretId);
    if (!secret?.trim()) return Promise.resolve(undefined);
    return Promise.resolve({ apiKey: secret.trim() });
  }
}
