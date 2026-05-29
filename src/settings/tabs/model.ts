import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Setting, SettingDefinitionItem } from "obsidian";
import type FlintPlugin from "@/main";
import { findModel } from "@/settings/types";

export function modelSettingDefinitions(
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  const items: SettingDefinitionItem[] = [
    {
      type: "group",
      heading: "Model",
      items: [
        {
          name: "Provider",
          desc: "Providers come from the built-in Pi model registry plus your custom providers.",
          render: (setting) => renderProviderSetting(plugin, setting),
        },
        {
          name: "Model",
          desc: "Models are filtered to the selected provider.",
          render: (setting) => renderModelSetting(plugin, setting),
        },
      ],
    },
  ];

  const currentModel = findModel(
    plugin.store.settings.customProviders,
    plugin.store.settings.provider,
    plugin.store.settings.modelId,
    plugin.store.settings.providerAuth,
  );

  if (currentModel?.reasoning) {
    items.push({
      type: "group",
      items: [
        {
          name: "Thinking level",
          desc: "Reasoning effort for models that support it.",
          render: (setting) => renderThinkingSetting(plugin, setting),
        },
      ],
    });
  }

  return items;
}

function renderProviderSetting(plugin: FlintPlugin, setting: Setting): void {
  const providers = plugin.modelRegistry.getProviders();
  const currentProvider = providers.includes(plugin.store.settings.provider)
    ? plugin.store.settings.provider
    : (providers[0] ?? "");

  setting.addDropdown((dropdown) => {
    for (const provider of providers) dropdown.addOption(provider, provider);
    dropdown.setValue(currentProvider);
    dropdown.onChange(async (value) => {
      await plugin.modelRegistry.setProvider(value);
      plugin.settingTab?.update();
    });
  });
}

function renderModelSetting(plugin: FlintPlugin, setting: Setting): void {
  const models = plugin.modelRegistry.getModelsForProvider(
    plugin.store.settings.provider,
  );

  setting.addDropdown((dropdown) => {
    for (const model of models) {
      dropdown.addOption(
        model.id,
        model.name ? `${model.name} (${model.id})` : model.id,
      );
    }
    dropdown.setValue(plugin.store.settings.modelId);
    dropdown.selectEl.style.fontFamily = "var(--font-monospace)";
    dropdown.onChange(async (value) => {
      await plugin.agent.setModel(plugin.store.settings.provider, value);
      plugin.settingTab?.update();
    });
  });
}

function renderThinkingSetting(plugin: FlintPlugin, setting: Setting): void {
  setting.addDropdown((dropdown) => {
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
      plugin.settingTab?.update();
    });
  });
}
