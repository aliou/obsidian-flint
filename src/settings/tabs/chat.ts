import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Setting } from "obsidian";
import { findModel } from "@/settings/types";
import type { SettingsTabContext } from "./types";

export function renderChatTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  ctx.renderPageHeader(
    containerEl,
    "Configure the active model used by the Flint sidebar.",
  );

  new Setting(containerEl).setName("Model").setHeading();

  const providers = plugin.modelRegistry.getProviders();
  const currentProvider = providers.includes(plugin.store.settings.provider)
    ? plugin.store.settings.provider
    : (providers[0] ?? "");

  new Setting(containerEl)
    .setName("Provider")
    .setDesc(
      "Providers come from the built-in Pi model registry plus your custom providers. If a provider does not require auth, disable it on the Providers page.",
    )
    .addDropdown((dropdown) => {
      for (const provider of providers) dropdown.addOption(provider, provider);
      dropdown.setValue(currentProvider);
      dropdown.onChange(async (value) => {
        try {
          await plugin.modelRegistry.setProvider(value);
          ctx.display();
        } catch (error) {
          ctx.notice(error);
        }
      });
    });

  const models = plugin.modelRegistry.getModelsForProvider(
    plugin.store.settings.provider,
  );
  const currentModel = findModel(
    plugin.store.settings.customProviders,
    plugin.store.settings.provider,
    plugin.store.settings.modelId,
  );

  new Setting(containerEl)
    .setName("Model")
    .setDesc("Models are filtered to the selected provider.")
    .addDropdown((dropdown) => {
      for (const model of models) {
        dropdown.addOption(
          model.id,
          model.name ? `${model.name} (${model.id})` : model.id,
        );
      }
      dropdown.setValue(plugin.store.settings.modelId);
      dropdown.selectEl.style.fontFamily = "var(--font-monospace)";
      dropdown.onChange(async (value) => {
        try {
          await plugin.agent.setModel(plugin.store.settings.provider, value);
          ctx.display();
        } catch (error) {
          ctx.notice(error);
        }
      });
    });

  new Setting(containerEl).setName("Empty state").setHeading();

  new Setting(containerEl)
    .setName("Suggestions")
    .setDesc(
      "Prompt chips shown before a conversation starts. Use one per line.",
    )
    .setClass("flint-stacked-setting")
    .addTextArea((text) => {
      text.inputEl.style.width = "100%";
      text.inputEl.rows = 4;
      text.setValue(plugin.store.settings.emptyStateSuggestions.join("\n"));
      text.onChange(async (value) => {
        const suggestions = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await plugin.store.update({ emptyStateSuggestions: suggestions });
      });
    });

  if (currentModel?.reasoning) {
    new Setting(containerEl)
      .setName("Thinking level")
      .setDesc("For models that support reasoning.")
      .addDropdown((dropdown) => {
        for (const level of [
          "off",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ] as const) {
          dropdown.addOption(level, level);
        }
        dropdown.setValue(plugin.store.settings.thinkingLevel);
        dropdown.onChange(async (value) => {
          await plugin.agent.setThinkingLevel(value as ThinkingLevel);
          ctx.display();
        });
      });
  }
}
