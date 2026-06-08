import type { App } from "obsidian";
import { normalizePath, type SettingDefinitionItem, TFile } from "obsidian";
import type FlintPlugin from "@/main";
import { skillsSettingDefinitions } from "./skills";

type SettingsDataContext = {
  app: App;
  plugin: FlintPlugin;
};

export function contextSettingDefinitions(
  app: App,
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      heading: "System prompt",
      items: [
        {
          name: "Custom system prompt",
          desc: "Optional text appended to the base system prompt. Supports dynamic context at turn start.",
          render: (setting) => {
            setting.setClass("flint-stacked-setting").addTextArea((text) => {
              text.inputEl.rows = 6;
              text.setValue(plugin.store.settings.systemPrompt);
              text.onChange(async (value) => {
                await plugin.store.update({ systemPrompt: value });
                plugin.store.notifyChange();
              });
            });
          },
        },
      ],
    },
    {
      type: "group",
      heading: "Instructions file",
      items: [
        {
          name: "AGENTS.md file",
          desc: "Vault path to an AGENTS.md file included in the system prompt.",
          control: {
            type: "file",
            key: "agentFilePath",
            defaultValue: "",
            placeholder: "Path to AGENTS.md",
            filter: (file) => file.name === "AGENTS.md",
          },
        },
        {
          name: "Instructions file status",
          searchable: false,
          render: (setting) => {
            void updateAgentFilePreview({ app, plugin }, setting.descEl);
          },
        },
      ],
    },
    ...skillsSettingDefinitions(app, plugin),
    {
      type: "group",
      heading: "Empty state",
      items: [
        {
          name: "Prompt suggestions",
          desc: "Prompt chips shown before a conversation starts. Use one per line.",
          render: (setting) => {
            setting.setClass("flint-stacked-setting").addTextArea((text) => {
              text.inputEl.rows = 4;
              text.setValue(
                plugin.store.settings.emptyStateSuggestions.join("\n"),
              );
              text.onChange(async (value) => {
                await plugin.store.update({
                  emptyStateSuggestions: value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                });
              });
            });
          },
        },
      ],
    },
  ];
}

async function updateAgentFilePreview(
  ctx: SettingsDataContext,
  parent: HTMLElement,
): Promise<void> {
  const path = ctx.plugin.store.settings.agentFilePath.trim();
  const preview = parent.createDiv({ cls: "flint-skill-description" });
  if (!path) {
    preview.setText("No AGENTS.md file selected.");
    return;
  }

  const file = ctx.app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(file instanceof TFile)) {
    preview.setText("Selected AGENTS.md file was not found.");
    return;
  }

  preview.setText(`Selected: ${path}`);
}
