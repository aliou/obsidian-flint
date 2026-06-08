import type { Setting, SettingDefinitionItem } from "obsidian";
import { DEFAULT_AUTO_NAME_PROMPT } from "@/chat/auto-name";
import type FlintPlugin from "@/main";

export function autoNameSettingDefinitions(
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  const settings = plugin.store.settings.autoNameSettings;
  const modelRegistry = plugin.modelRegistry;
  const secrets = plugin.secrets;
  const configuredProviders = modelRegistry
    .getProviders()
    .filter((provider) => secrets.hasCredential(provider));

  return [
    {
      type: "group",
      heading: "Auto-name",
      items: [
        {
          name: "Enable auto-naming",
          desc: "After the first successful turn, generate a concise session name automatically.",
          control: {
            type: "toggle",
            key: "autoName.enabled",
            defaultValue: true,
          },
        },
        {
          name: "Naming prompt",
          desc: "System prompt for the naming LLM call. Must instruct the model to call the set_name tool.",
          render: (setting) => {
            setting
              .setClass("flint-stacked-setting")
              .addTextArea((text) => {
                text.inputEl.rows = 6;
                text.setValue(settings.prompt);
                text.onChange(async (value) => {
                  settings.prompt = value;
                  await plugin.store.save();
                });
              })
              .addExtraButton((button) =>
                button
                  .setIcon("reset")
                  .setTooltip("Reset to default prompt")
                  .onClick(async () => {
                    settings.prompt = DEFAULT_AUTO_NAME_PROMPT;
                    await plugin.store.save();
                    plugin.settingTab?.update();
                  }),
              );
          },
        },
      ],
    },
    {
      type: "group",
      heading: "Model",
      items: [
        {
          name: "Provider",
          desc: "Provider for the naming call. Defaults to the current chat provider.",
          render: (setting: Setting) => {
            setting.addDropdown((dropdown) => {
              dropdown.addOption("", "Use current chat provider");
              for (const provider of configuredProviders) {
                dropdown.addOption(provider, provider);
              }
              dropdown.setValue(settings.provider ?? "");
              dropdown.onChange(async (value) => {
                settings.provider = value || undefined;
                settings.modelId = undefined;
                await plugin.store.save();
                plugin.settingTab?.update();
              });
            });
          },
        },
        {
          name: "Model",
          desc: "Model for the naming call. Defaults to the current chat model.",
          visible: () => Boolean(settings.provider),
          render: (setting: Setting) => {
            if (!settings.provider) return;
            const models = modelRegistry.getModelsForProvider(
              settings.provider,
            );
            setting.addDropdown((dropdown) => {
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
          },
        },
      ],
    },
  ];
}
