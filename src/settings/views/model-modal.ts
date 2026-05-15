import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";
import {
  type CustomProviderModelConfig,
  createDefaultModelConfig,
} from "@/settings/types";
import { noticeError } from "@/utils/errors";

export class ModelConfigModal extends Modal {
  private model: CustomProviderModelConfig;
  private compatJson: string;
  private headersJson: string;

  constructor(
    app: App,
    model: CustomProviderModelConfig,
    private readonly onSave: (model: CustomProviderModelConfig) => void,
  ) {
    super(app);
    this.model = {
      ...createDefaultModelConfig(model.id),
      ...model,
      cost: { ...createDefaultModelConfig(model.id).cost, ...model.cost },
    };
    this.compatJson = this.model.compat
      ? JSON.stringify(this.model.compat, null, 2)
      : "";
    this.headersJson = this.model.headers
      ? JSON.stringify(this.model.headers, null, 2)
      : "";
  }

  onOpen(): void {
    this.setTitle(this.model.id ? `Model: ${this.model.id}` : "Add model");
    this.modalEl.addClass("flint-provider-modal-wide");
    this.contentEl.empty();
    this.contentEl.addClass("flint-provider-modal");

    new Setting(this.contentEl).setName("Identity").setHeading();
    new Setting(this.contentEl)
      .setName("Model id")
      .setDesc("The id sent to the OpenAI-compatible API.")
      .addText((text) =>
        text
          .setValue(this.model.id)
          .onChange((value) => (this.model.id = value)),
      );
    new Setting(this.contentEl)
      .setName("Name")
      .setDesc("Display name.")
      .addText((text) =>
        text
          .setValue(this.model.name)
          .onChange((value) => (this.model.name = value)),
      );

    new Setting(this.contentEl).setName("Capabilities").setHeading();
    new Setting(this.contentEl)
      .setName("Reasoning")
      .setDesc("Whether this model supports extended thinking.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.model.reasoning)
          .onChange((value) => (this.model.reasoning = value)),
      );
    new Setting(this.contentEl)
      .setName("Text input")
      .addToggle((toggle) =>
        toggle
          .setValue(this.model.input.includes("text"))
          .onChange((value) => this.setInput(value)),
      );

    new Setting(this.contentEl).setName("Limits").setHeading();
    new Setting(this.contentEl)
      .setName("Context window")
      .setDesc("Tokens. Use 0 if unknown.")
      .addText((text) =>
        text
          .setValue(String(this.model.contextWindow))
          .onChange((value) => (this.model.contextWindow = Number(value) || 0)),
      );
    new Setting(this.contentEl)
      .setName("Max output tokens")
      .setDesc("Use 0 if unknown.")
      .addText((text) =>
        text
          .setValue(String(this.model.maxTokens))
          .onChange((value) => (this.model.maxTokens = Number(value) || 0)),
      );

    new Setting(this.contentEl).setName("Cost").setHeading();
    new Setting(this.contentEl)
      .setName("Cost per million tokens")
      .setDesc("Input, output, cache read, cache write. Use 0 if unknown.")
      .addText((text) =>
        text
          .setPlaceholder("input")
          .setValue(String(this.model.cost.input))
          .onChange((value) => (this.model.cost.input = Number(value) || 0)),
      )
      .addText((text) =>
        text
          .setPlaceholder("output")
          .setValue(String(this.model.cost.output))
          .onChange((value) => (this.model.cost.output = Number(value) || 0)),
      )
      .addText((text) =>
        text
          .setPlaceholder("cache read")
          .setValue(String(this.model.cost.cacheRead))
          .onChange(
            (value) => (this.model.cost.cacheRead = Number(value) || 0),
          ),
      )
      .addText((text) =>
        text
          .setPlaceholder("cache write")
          .setValue(String(this.model.cost.cacheWrite))
          .onChange(
            (value) => (this.model.cost.cacheWrite = Number(value) || 0),
          ),
      );

    new Setting(this.contentEl).setName("Advanced").setHeading();
    new Setting(this.contentEl)
      .setName("Headers JSON")
      .setDesc("Optional per-model headers object.")
      .setClass("flint-stacked-setting")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.inputEl.addClass("flint-json-input");
        text
          .setValue(this.headersJson)
          .onChange((value) => (this.headersJson = value));
      });
    new Setting(this.contentEl)
      .setName("OpenAI compat JSON")
      .setDesc(
        "Optional compat object in the same shape as Pi model definitions.",
      )
      .setClass("flint-stacked-setting")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text.inputEl.addClass("flint-json-input");
        text
          .setValue(this.compatJson)
          .onChange((value) => (this.compatJson = value));
      });

    const actions = this.contentEl.createDiv("flint-modal-actions");
    actions
      .createEl("button", { text: "Cancel" })
      .addEventListener("click", () => this.close());
    actions
      .createEl("button", { text: "Save model", cls: "mod-cta" })
      .addEventListener("click", () => this.save());
  }

  private setInput(enabled: boolean): void {
    this.model.input = enabled ? ["text"] : [];
  }

  private save(): void {
    try {
      this.model.id = this.model.id.trim();
      this.model.name = this.model.name.trim() || this.model.id;
      if (!this.model.id) throw new Error("Model id is required");
      this.model.input = ["text"];
      this.model.headers = this.headersJson.trim()
        ? (JSON.parse(this.headersJson) as Record<string, string>)
        : undefined;
      this.model.compat = this.compatJson.trim()
        ? (JSON.parse(this.compatJson) as CustomProviderModelConfig["compat"])
        : undefined;
      this.onSave(this.model);
      this.close();
    } catch (error) {
      noticeError(error);
    }
  }
}
