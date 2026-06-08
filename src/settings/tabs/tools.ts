import type { SettingDefinitionItem } from "obsidian";
import { VAULT_TOOL_DEFINITIONS } from "@/harness/tools";
import type FlintPlugin from "@/main";

export function toolsSettingDefinitions(): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      heading: "Vault tools",
      items: VAULT_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.label,
        desc: tool.description,
        control: {
          type: "toggle" as const,
          key: `tool:${tool.name}`,
          defaultValue: true,
        },
      })),
    },
  ];
}

export async function setToolEnabled(
  plugin: FlintPlugin,
  toolName: string,
  enabled: boolean,
): Promise<void> {
  const current = new Set(plugin.store.settings.enabledTools);
  if (enabled) current.add(toolName);
  else current.delete(toolName);
  const next = [...current];
  plugin.store.settings.enabledTools = next;
  await plugin.store.save();
  await plugin.agent.updateEnabledTools(next);
}
