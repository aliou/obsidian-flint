import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { FlintSettingsStore } from "@/settings/store";
import {
  allModels,
  type CustomProviderConfig,
  createDefaultModelConfig,
  ensureValidSelection,
  findModel,
  modelsForProvider,
  normalizeProviderId,
  providerNames,
} from "@/settings/types";

type ModelSink = {
  setModel(provider: string, modelId: string): Promise<void>;
};

export class ModelRegistry {
  private modelSink?: ModelSink;

  constructor(private readonly store: FlintSettingsStore) {}

  setModelSink(modelSink: ModelSink): void {
    this.modelSink = modelSink;
  }

  getProviders(): string[] {
    return providerNames(this.store.settings.customProviders);
  }

  getModelsForProvider(provider: string): Model<Api>[] {
    return modelsForProvider(this.store.settings.customProviders, provider);
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return findModel(this.store.settings.customProviders, provider, modelId);
  }

  getCurrentModel(): Model<Api> | undefined {
    return this.getModel(
      this.store.settings.provider,
      this.store.settings.modelId,
    );
  }

  async setModelSelection(
    provider: string,
    modelId: string,
  ): Promise<{ model: Model<Api>; thinkingLevel: ThinkingLevel }> {
    const model = this.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    const thinkingLevel = model.reasoning
      ? this.store.settings.thinkingLevel
      : "off";
    await this.store.update({ provider, modelId, thinkingLevel });
    return { model, thinkingLevel };
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<ThinkingLevel> {
    const model = this.getCurrentModel();
    const next = model?.reasoning ? level : "off";
    await this.store.update({ thinkingLevel: next });
    return next;
  }

  async resolveHarnessModel(options?: {
    restored?: { provider: string; modelId: string };
    thinkingLevel?: ThinkingLevel;
  }): Promise<{ model: Model<Api>; thinkingLevel: ThinkingLevel }> {
    const restoredModel = options?.restored
      ? this.getModel(options.restored.provider, options.restored.modelId)
      : undefined;
    const model =
      restoredModel ??
      this.getCurrentModel() ??
      allModels(this.store.settings.customProviders).find(
        (candidate) => candidate.provider === this.store.settings.provider,
      ) ??
      allModels(this.store.settings.customProviders)[0];
    if (!model) throw new Error("No Pi models available");

    const thinkingLevel = model.reasoning
      ? (options?.thinkingLevel ?? this.store.settings.thinkingLevel)
      : "off";
    await this.store.update({
      provider: model.provider,
      modelId: model.id,
      thinkingLevel,
    });
    return { model, thinkingLevel };
  }

  isFavoriteModel(provider: string, modelId: string): boolean {
    return this.store.settings.favoriteModels.includes(
      `${provider}/${modelId}`,
    );
  }

  async toggleFavoriteModel(provider: string, modelId: string): Promise<void> {
    const key = `${provider}/${modelId}`;
    const favorites = new Set(this.store.settings.favoriteModels);
    if (favorites.has(key)) favorites.delete(key);
    else favorites.add(key);
    this.store.settings.favoriteModels = [...favorites].sort((a, b) =>
      a.localeCompare(b),
    );
    await this.store.save();
    this.store.notifyChange();
  }

  async setProvider(provider: string): Promise<void> {
    const models = modelsForProvider(
      this.store.settings.customProviders,
      provider,
    );
    if (models.length === 0)
      throw new Error(`No models for provider: ${provider}`);
    this.store.settings.provider = provider;
    if (!models.some((model) => model.id === this.store.settings.modelId))
      this.store.settings.modelId = models[0]?.id;
    const selected = findModel(
      this.store.settings.customProviders,
      this.store.settings.provider,
      this.store.settings.modelId,
    );
    if (selected && !selected.reasoning)
      this.store.settings.thinkingLevel = "off";
    await this.setModelSelection(
      this.store.settings.provider,
      this.store.settings.modelId,
    );
    await this.modelSink?.setModel(
      this.store.settings.provider,
      this.store.settings.modelId,
    );
  }

  async upsertCustomProvider(config: CustomProviderConfig): Promise<void> {
    const providerId = normalizeProviderId(config.id);
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const models = config.models
      .filter((model) => model.id.trim())
      .map((model) => ({
        ...createDefaultModelConfig(model.id.trim()),
        ...model,
        id: model.id.trim(),
        name: model.name?.trim() || model.id.trim(),
      }));
    if (!providerId) throw new Error("Provider id is required");
    if (!baseUrl) throw new Error("Base URL is required");
    if (models.length === 0)
      throw new Error("At least one model id is required");

    const next = this.store.settings.customProviders.filter(
      (provider) => provider.id !== providerId,
    );
    next.push({
      ...config,
      id: providerId,
      baseUrl,
      requiresApiKey: config.requiresApiKey !== false,
      secretId: config.secretId,
      models,
    });
    this.store.settings.customProviders = next.sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    this.store.refreshFetchPatch();
    ensureValidSelection(this.store.settings);
    await this.store.save();
    await this.modelSink?.setModel(
      this.store.settings.provider,
      this.store.settings.modelId,
    );
  }

  async removeCustomProvider(providerId: string): Promise<void> {
    this.store.settings.customProviders =
      this.store.settings.customProviders.filter(
        (provider) => provider.id !== providerId,
      );
    delete this.store.settings.providerAuth[providerId];
    this.store.refreshFetchPatch();
    ensureValidSelection(this.store.settings);
    await this.store.save();
    await this.modelSink?.setModel(
      this.store.settings.provider,
      this.store.settings.modelId,
    );
  }
}
