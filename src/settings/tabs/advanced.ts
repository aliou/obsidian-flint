import { normalizePath, type SettingDefinitionItem } from "obsidian";
import type FlintPlugin from "@/main";

export function advancedSettingDefinitions(
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      heading: "Session storage",
      items: [
        {
          name: "Storage path",
          desc: "Vault-relative path where session files are stored. Changing this takes effect on the next new session. Existing sessions remain accessible.",
          control: {
            type: "folder",
            key: "sessionStoragePath",
            defaultValue: "Flint/Sessions",
            placeholder: "Flint/Sessions",
            includeRoot: true,
            validate: (value) => {
              const normalized = normalizePath(value.trim());
              if (!normalized || normalized === "/")
                return "Choose a folder path.";
            },
          },
        },
      ],
    },
    {
      type: "group",
      heading: "Compaction",
      items: [
        {
          name: "Enable compaction",
          desc: "Allow automatic compaction of session history.",
          control: {
            type: "toggle",
            key: "compaction.enabled",
            defaultValue: true,
          },
        },
        {
          name: "Reserve tokens",
          desc: "Tokens reserved for the compaction summary prompt and output.",
          control: {
            type: "number",
            key: "compaction.reserveTokens",
            defaultValue: 16384,
            min: 0,
            step: 1,
          },
        },
        {
          name: "Keep recent tokens",
          desc: "Approximate recent-context tokens to retain after compaction.",
          control: {
            type: "number",
            key: "compaction.keepRecentTokens",
            defaultValue: 20000,
            min: 0,
            step: 1,
          },
        },
        {
          name: "Compaction custom prompt",
          desc: "Optional custom instructions appended to the compaction summary prompt.",
          render: (setting) => {
            setting.setClass("flint-stacked-setting").addTextArea((text) => {
              text.inputEl.rows = 4;
              text.setValue(plugin.store.settings.compactionCustomPrompt);
              text.onChange(async (value) => {
                await plugin.store.update({ compactionCustomPrompt: value });
              });
            });
          },
        },
      ],
    },
  ];
}

export async function setCompactionSetting(
  plugin: FlintPlugin,
  key: "enabled" | "reserveTokens" | "keepRecentTokens",
  value: boolean | number,
): Promise<void> {
  plugin.store.settings.compactionSettings = {
    ...plugin.store.settings.compactionSettings,
    [key]: value,
  };
  await plugin.store.save();
}
