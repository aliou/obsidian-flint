import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { Modal, Setting, setIcon } from "obsidian";
import type FlintPlugin from "@/main";
import { noticeError } from "@/utils/errors";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies readonly ThinkingLevel[];

type ModelOption = {
  provider: string;
  model: Model<Api>;
};

export class ModelPickerModal extends Modal {
  private query = "";

  constructor(private readonly plugin: FlintPlugin) {
    super(plugin.app);
  }

  override onOpen(): void {
    this.containerEl.addClass("flint-chat-model-picker-modal");
    this.setTitle("Select model");
    this.render();
  }

  override onClose(): void {
    this.containerEl.removeClass("flint-chat-model-picker-modal");
    this.contentEl.empty();
  }

  private render(): void {
    this.contentEl.empty();

    const search = this.contentEl.createEl("input", {
      cls: "flint-chat-model-picker-search",
      attr: {
        type: "search",
        placeholder: "Search models...",
        "aria-label": "Search models",
      },
    });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
      this.contentEl
        .querySelector<HTMLInputElement>(".flint-chat-model-picker-search")
        ?.focus();
    });

    const options = this.filteredOptions();
    if (options.length === 0) {
      this.contentEl.createDiv({
        cls: "flint-chat-model-picker-empty",
        text: "No configured models found.",
      });
      this.renderThinkingSetting();
      return;
    }

    const favorites = options.filter(({ provider, model }) =>
      this.plugin.modelRegistry.isFavoriteModel(provider, model.id),
    );
    const hasFavorites = favorites.length > 0;
    const isSearching = this.query.trim().length > 0;
    if (hasFavorites && !isSearching)
      this.renderSection("Favorites", favorites);

    const byProvider = new Map<string, ModelOption[]>();
    for (const option of options) {
      if (
        hasFavorites &&
        !isSearching &&
        this.plugin.modelRegistry.isFavoriteModel(
          option.provider,
          option.model.id,
        )
      )
        continue;
      if (!byProvider.has(option.provider)) byProvider.set(option.provider, []);
      byProvider.get(option.provider)?.push(option);
    }
    for (const [provider, providerOptions] of byProvider) {
      this.renderSection(
        provider,
        providerOptions,
        hasFavorites && !isSearching,
      );
    }

    this.renderThinkingSetting();
  }

  private filteredOptions(): ModelOption[] {
    const query = this.query.trim().toLowerCase();
    const options = this.plugin.modelRegistry
      .getProviders()
      .filter((provider) => this.plugin.secrets.hasCredential(provider))
      .flatMap((provider) =>
        this.plugin.modelRegistry
          .getModelsForProvider(provider)
          .map((model) => ({ provider, model })),
      );

    if (!query) return options;
    return options.filter(({ provider, model }) => {
      const haystack = `${provider} ${model.id} ${model.name}`.toLowerCase();
      return query.split(/\s+/).every((part) => haystack.includes(part));
    });
  }

  private renderSection(
    title: string,
    options: ModelOption[],
    collapsed = false,
  ): void {
    const section = this.contentEl.createEl("details", {
      cls: "flint-chat-model-picker-section",
    });
    section.open = !collapsed;
    const summary = section.createEl("summary", {
      cls: "flint-chat-model-picker-provider",
    });
    const chevron = summary.createSpan("flint-chat-model-picker-chevron");
    setIcon(chevron, "chevron-right");
    summary.createSpan({ cls: "flint-chat-model-picker-title", text: title });
    summary.createSpan({
      cls: "flint-chat-model-picker-count",
      text: String(options.length),
    });

    const list = section.createDiv("flint-chat-model-picker-list");
    for (const { provider, model } of options)
      this.renderRow(list, provider, model);
  }

  private renderRow(
    parent: HTMLElement,
    provider: string,
    model: Model<Api>,
  ): void {
    const selected =
      provider === this.plugin.store.settings.provider &&
      model.id === this.plugin.store.settings.modelId;
    const row = parent.createDiv("flint-chat-model-picker-row-wrap");
    row.toggleClass("is-selected", selected);
    const modelButton = row.createEl("button", {
      cls: "flint-chat-model-picker-row",
      attr: {
        type: "button",
        "aria-pressed": String(selected),
      },
    });
    modelButton.toggleClass("is-selected", selected);
    const text = modelButton.createDiv("flint-chat-model-picker-row-text");
    text.createDiv({
      cls: "flint-chat-model-picker-name",
      text: model.id,
    });
    const meta = text.createDiv("flint-chat-model-picker-meta");
    const reasoning = meta.createSpan("flint-chat-model-picker-meta-item");
    reasoning.setAttr(
      "aria-label",
      model.reasoning ? "Reasoning supported" : "No reasoning",
    );
    reasoning.setAttr(
      "title",
      model.reasoning ? "Reasoning supported" : "No reasoning",
    );
    setIcon(reasoning, model.reasoning ? "brain" : "minus-circle");
    meta.createSpan({ cls: "flint-chat-model-picker-separator", text: "—" });
    meta.createSpan({
      cls: "flint-chat-model-picker-context",
      text: this.formatContextWindow(model.contextWindow),
    });
    const check = modelButton.createSpan("flint-chat-model-picker-check");
    if (selected) setIcon(check, "check");

    modelButton.addEventListener("click", () => {
      void this.selectModel(provider, model.id);
    });

    const favoriteButton = row.createEl("button", {
      cls: "flint-chat-model-picker-favorite",
      attr: {
        type: "button",
        "aria-label": this.plugin.modelRegistry.isFavoriteModel(
          provider,
          model.id,
        )
          ? "Remove favorite model"
          : "Favorite model",
        title: this.plugin.modelRegistry.isFavoriteModel(provider, model.id)
          ? "Remove favorite"
          : "Favorite",
      },
    });
    favoriteButton.toggleClass(
      "is-favorite",
      this.plugin.modelRegistry.isFavoriteModel(provider, model.id),
    );
    setIcon(favoriteButton, "star");
    favoriteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.plugin.modelRegistry
        .toggleFavoriteModel(provider, model.id)
        .then(() => this.render());
    });
  }

  private renderThinkingSetting(): void {
    const currentModel = this.plugin.modelRegistry
      .getModelsForProvider(this.plugin.store.settings.provider)
      .find((model) => model.id === this.plugin.store.settings.modelId);
    const supportsReasoning = currentModel?.reasoning === true;

    new Setting(this.contentEl)
      .setClass("flint-chat-model-picker-thinking")
      .setName("Thinking level")
      .setDesc(
        supportsReasoning
          ? "Controls reasoning depth for the selected model."
          : "Unavailable for the selected model.",
      )
      .addDropdown((dropdown) => {
        for (const level of THINKING_LEVELS) dropdown.addOption(level, level);
        dropdown.setValue(
          supportsReasoning ? this.plugin.store.settings.thinkingLevel : "off",
        );
        dropdown.setDisabled(!supportsReasoning);
        dropdown.onChange(async (value) => {
          await this.plugin.agent.setThinkingLevel(value as ThinkingLevel);
        });
      });
  }

  private formatContextWindow(value?: number): string {
    if (typeof value !== "number") return "--";
    if (value < 1_000) return String(Math.round(value));
    if (value < 1_000_000)
      return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  private async selectModel(provider: string, modelId: string): Promise<void> {
    try {
      await this.plugin.agent.setModel(provider, modelId);
      this.render();
    } catch (error) {
      noticeError(error);
    }
  }
}
