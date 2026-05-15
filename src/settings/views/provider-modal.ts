import { type App, Modal, Notice, Setting } from "obsidian";
import type FlintPlugin from "@/main";
import {
  type CustomProviderConfig,
  type CustomProviderModelConfig,
  createDefaultModelConfig,
  normalizeProviderId,
} from "@/settings/types";
import { ModelConfigModal } from "@/settings/views/model-modal";
import { noticeError } from "@/utils/errors";

export class CustomProviderModal extends Modal {
  private providerId: string;
  private providerName: string;
  private baseUrl: string;
  private requiresApiKey: boolean;
  private secretId: string;
  private models: CustomProviderModelConfig[];
  private modelsContainer?: HTMLElement;
  private statusEl?: HTMLElement;

  constructor(
    app: App,
    private readonly plugin: FlintPlugin,
    provider: CustomProviderConfig | undefined,
    private readonly onSaved: () => void,
  ) {
    super(app);
    this.providerId = provider?.id ?? "";
    this.providerName = provider?.name ?? "";
    this.baseUrl = provider?.baseUrl ?? "";
    this.requiresApiKey = provider?.requiresApiKey !== false;
    this.secretId = provider?.secretId ?? "";
    this.models =
      provider?.models.map((model) => ({
        ...createDefaultModelConfig(model.id),
        ...model,
      })) ?? [];
  }

  onOpen(): void {
    this.setTitle(
      this.providerId
        ? `Edit provider: ${this.providerId}`
        : "Add OpenAI-compatible provider",
    );
    this.modalEl.addClass("flint-provider-modal-wide");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.addClass("flint-provider-modal");
    this.renderConnectionSection();
    this.renderCredentialSection();
    this.renderModelsSection();
    this.renderActions();
  }

  private renderConnectionSection(): void {
    new Setting(this.contentEl).setName("Connection").setHeading();

    new Setting(this.contentEl)
      .setName("Provider id")
      .setDesc("Stable lowercase id shown in the provider dropdown.")
      .addText((text) =>
        text
          .setPlaceholder("openai-compatible")
          .setValue(this.providerId)
          .onChange((value) => {
            this.providerId = value;
          }),
      );

    new Setting(this.contentEl)
      .setName("Display name")
      .setDesc("Optional friendly name for this provider.")
      .addText((text) =>
        text
          .setPlaceholder("My provider")
          .setValue(this.providerName)
          .onChange((value) => (this.providerName = value)),
      );

    new Setting(this.contentEl)
      .setName("Base URL")
      .setDesc("OpenAI-compatible base URL. Usually ends in /v1.")
      .addText((text) => {
        text.inputEl.addClass("flint-wide-input");
        text
          .setPlaceholder("https://api.example.com/v1")
          .setValue(this.baseUrl)
          .onChange((value) => (this.baseUrl = value));
      });
  }

  private renderCredentialSection(): void {
    new Setting(this.contentEl).setName("Credential").setHeading();

    new Setting(this.contentEl)
      .setName("Requires API key")
      .setDesc(
        "Disable this when the provider endpoint ignores Authorization or does not need credentials.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.requiresApiKey).onChange((value) => {
          this.requiresApiKey = value;
          this.render();
        }),
      );

    if (!this.requiresApiKey) {
      new Setting(this.contentEl)
        .setName("Secret")
        .setDesc(
          "No API key required. This provider is considered configured.",
        );
      return;
    }

    new Setting(this.contentEl)
      .setName("Secret")
      .setDesc(
        "Select a secret from Obsidian SecretStorage to use as the API key.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("", "No secret linked");
        for (const id of this.plugin.secrets.listSecretIds())
          dropdown.addOption(id, id);
        dropdown.setValue(this.secretId);
        dropdown.onChange((value) => {
          this.secretId = value;
        });
      })
      .addButton((button) =>
        button.setButtonText("+ Add secret").onClick(() => {
          this.plugin.secrets.openAddSecretModal((newSecretId) => {
            this.secretId = newSecretId;
            this.render();
          });
        }),
      );
  }

  private renderModelsSection(): void {
    new Setting(this.contentEl).setName("Models").setHeading();

    new Setting(this.contentEl)
      .setName("Discover model ids")
      .setDesc(
        "Fetches OpenAI-style GET /models. Discovery only fills ids/names; edit each model to set Pi model metadata.",
      )
      .addButton((button) =>
        button
          .setButtonText("Discover")
          .setCta()
          .onClick(() => void this.discoverModels()),
      );

    this.statusEl = this.contentEl.createDiv("flint-discovery-status");
    this.updateStatus();

    new Setting(this.contentEl)
      .setName("Add model")
      .setDesc(
        "Add a model and then configure it in the same shape as Pi model definitions.",
      )
      .addButton((button) =>
        button.setButtonText("Add model").onClick(() => {
          new ModelConfigModal(
            this.app,
            createDefaultModelConfig(""),
            (model) => {
              this.upsertModel(model);
              this.renderModelList();
            },
          ).open();
        }),
      );

    this.modelsContainer = this.contentEl.createDiv("flint-model-picker");
    this.renderModelList();
  }

  private renderActions(): void {
    const actions = this.contentEl.createDiv("flint-modal-actions");
    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
    actions
      .createEl("button", { text: "Save provider", cls: "mod-cta" })
      .addEventListener("click", () => void this.save());
  }

  private async discoverModels(): Promise<void> {
    try {
      this.setStatus("Discovering models…");
      const discovered = await this.plugin.secrets.discoverOpenAIModels(
        this.baseUrl,
        this.requiresApiKey ? this.secretId || undefined : undefined,
      );
      if (discovered.length === 0) throw new Error("No models returned");
      for (const model of discovered)
        this.upsertModel({
          ...model,
          ...this.models.find((existing) => existing.id === model.id),
        });
      this.renderModelList();
      this.setStatus(
        `Discovered ${discovered.length} model id${discovered.length === 1 ? "" : "s"}. Edit models to set context, tokens, cost, and inputs.`,
      );
    } catch (error) {
      console.error(error);
      this.setStatus(
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
  }

  private upsertModel(model: CustomProviderModelConfig): void {
    const normalized = {
      ...createDefaultModelConfig(model.id),
      ...model,
      id: model.id.trim(),
      name: model.name.trim() || model.id.trim(),
    };
    if (!normalized.id) return;
    const index = this.models.findIndex(
      (existing) => existing.id === normalized.id,
    );
    if (index === -1) this.models.push(normalized);
    else this.models[index] = normalized;
    this.models.sort((a, b) => a.id.localeCompare(b.id));
  }

  private renderModelList(): void {
    if (!this.modelsContainer) return;
    this.modelsContainer.empty();

    if (this.models.length === 0) {
      this.modelsContainer.createDiv({
        cls: "flint-empty-state",
        text: "No models yet. Discover model ids or add one manually.",
      });
      this.updateStatus();
      return;
    }

    for (const model of this.models) {
      const row = this.modelsContainer.createDiv("flint-model-row");
      const body = row.createDiv("flint-model-row-body");
      body.createDiv({
        cls: "flint-model-row-title",
        text:
          model.name !== model.id ? `${model.name} (${model.id})` : model.id,
      });
      body.createDiv({
        cls: "flint-model-row-meta",
        text: this.modelMetaText(model),
      });

      const actions = row.createDiv("flint-model-row-actions");
      actions
        .createEl("button", { text: "Edit" })
        .addEventListener("click", () => {
          new ModelConfigModal(this.app, model, (updated) => {
            this.upsertModel(updated);
            this.renderModelList();
          }).open();
        });
      actions
        .createEl("button", { text: "Remove" })
        .addEventListener("click", () => {
          this.models = this.models.filter(
            (existing) => existing.id !== model.id,
          );
          this.renderModelList();
        });
    }

    this.updateStatus();
  }

  private modelMetaText(model: CustomProviderModelConfig): string {
    const inputs = model.input.join("+") || "no input";
    const cost = `cost ${model.cost.input}/${model.cost.output}/${model.cost.cacheRead}/${model.cost.cacheWrite}`;
    return `${inputs} · reasoning ${model.reasoning ? "yes" : "no"} · context ${model.contextWindow || "unset"} · max ${model.maxTokens || "unset"} · ${cost}`;
  }

  private updateStatus(): void {
    this.setStatus(
      `${this.models.length} configured model${this.models.length === 1 ? "" : "s"}`,
    );
  }

  private setStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", isError);
  }

  private async save(): Promise<void> {
    try {
      const providerId = normalizeProviderId(this.providerId);
      await this.plugin.modelRegistry.upsertCustomProvider({
        id: providerId,
        name: this.providerName.trim() || undefined,
        baseUrl: this.baseUrl,
        requiresApiKey: this.requiresApiKey,
        secretId: this.requiresApiKey ? this.secretId || undefined : undefined,
        models: this.models,
      });
      new Notice("Provider saved");
      this.onSaved();
      this.close();
    } catch (error) {
      noticeError(error);
    }
  }
}
