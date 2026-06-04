import { Setting } from "obsidian";
import { DEFAULT_AUTO_NAME_PROMPT } from "@/chat/auto-name";
import type { SettingsTabContext } from "./types";

export function renderAutoNameTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  const settings = plugin.store.settings.autoNameSettings;

  ctx.renderPageHeader(
    containerEl,
    "Automatically name sessions after the first turn using an LLM.",
  );

  new Setting(containerEl).setName("Auto-name").setHeading();

  new Setting(containerEl)
    .setName("Enable auto-naming")
    .setDesc(
      "After the first successful turn, generate a concise session name automatically.",
    )
    .addToggle((toggle) =>
      toggle.setValue(settings.enabled).onChange(async (value) => {
        settings.enabled = value;
        await plugin.store.save();
      }),
    );

  new Setting(containerEl)
    .setName("Naming prompt")
    .setDesc(
      "System prompt for the naming LLM call. Must instruct the model to call the set_name tool.",
    )
    .setClass("flint-stacked-setting")
    .addTextArea((text) => {
      text.inputEl.style.width = "100%";
      text.inputEl.rows = 6;
      text.setValue(settings.prompt);
      text.onChange(async (value) => {
        settings.prompt = value;
        await plugin.store.save();
      });
    })
    .addExtraButton((btn) =>
      btn
        .setIcon("reset")
        .setTooltip("Reset to default prompt")
        .onClick(async () => {
          settings.prompt = DEFAULT_AUTO_NAME_PROMPT;
          await plugin.store.save();
          ctx.display();
        }),
    );

  new Setting(containerEl).setName("Model").setHeading();

  const modelRegistry = plugin.modelRegistry;
  const secrets = plugin.secrets;

  const configuredProviders = modelRegistry
    .getProviders()
    .filter((provider) => secrets.hasCredential(provider));

  new Setting(containerEl)
    .setName("Provider")
    .setDesc(
      "Provider for the naming call. Defaults to the current chat provider.",
    )
    .addDropdown((dropdown) => {
      dropdown.addOption("", "Use current chat provider");
      for (const provider of configuredProviders) {
        dropdown.addOption(provider, provider);
      }
      dropdown.setValue(settings.provider ?? "");
      dropdown.onChange(async (value) => {
        settings.provider = value || undefined;
        settings.modelId = undefined;
        await plugin.store.save();
        ctx.display();
      });
    });

  if (settings.provider) {
    const models = modelRegistry.getModelsForProvider(settings.provider);
    new Setting(containerEl)
      .setName("Model")
      .setDesc("Model for the naming call. Defaults to the current chat model.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Use current chat model");
        for (const model of models) {
          dropdown.addOption(model.id, model.name ?? model.id);
        }
        dropdown.setValue(settings.modelId ?? "");
        dropdown.onChange(async (value) => {
          settings.modelId = value || undefined;
          await plugin.store.save();
        });
      });
  }
}
