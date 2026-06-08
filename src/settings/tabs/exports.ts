import { normalizePath, type SettingDefinitionItem } from "obsidian";
import type FlintPlugin from "@/main";
import type { FlintExportSettings } from "@/settings/types";

export function exportSettingDefinitions(): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      heading: "Output",
      items: [
        {
          name: "Output directory",
          desc: "Vault-relative folder where conversation export files are created.",
          control: {
            type: "folder",
            key: "export.outputDirectory",
            defaultValue: "Flint Exports",
            placeholder: "Flint Exports",
            includeRoot: true,
            validate: (value) =>
              normalizePath(value.trim()) ? undefined : "Choose a folder path.",
          },
        },
      ],
    },
    {
      type: "group",
      heading: "Content",
      items: [
        {
          name: "Include reasoning",
          desc: "Include model reasoning blocks in Markdown exports.",
          control: {
            type: "toggle",
            key: "export.includeReasoning",
            defaultValue: true,
          },
        },
        {
          name: "Include tool calls",
          desc: "Include tool call blocks in Markdown exports.",
          control: {
            type: "toggle",
            key: "export.includeToolCalls",
            defaultValue: true,
          },
        },
      ],
    },
  ];
}

export async function setExportSetting(
  plugin: FlintPlugin,
  patch: Partial<FlintExportSettings>,
): Promise<void> {
  await plugin.store.update({
    exportSettings: {
      ...plugin.store.settings.exportSettings,
      ...patch,
    },
  });
}
