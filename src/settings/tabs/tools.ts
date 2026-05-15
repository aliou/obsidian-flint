import { Setting } from "obsidian";
import { VAULT_TOOL_DEFINITIONS } from "@/harness/tools";
import type { SettingsTabContext } from "./types";

export function renderToolsTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  ctx.renderPageHeader(
    containerEl,
    "Toggle which vault tools the agent can use.",
  );

  new Setting(containerEl).setName("Vault tools").setHeading();

  for (const tool of VAULT_TOOL_DEFINITIONS) {
    new Setting(containerEl)
      .setName(tool.label)
      .setDesc(tool.description)
      .addToggle((toggle) =>
        toggle
          .setValue(plugin.store.settings.enabledTools.includes(tool.name))
          .onChange(async (enabled) => {
            const current = new Set(plugin.store.settings.enabledTools);
            if (enabled) current.add(tool.name);
            else current.delete(tool.name);
            const next = [...current];
            plugin.store.settings.enabledTools = next;
            await plugin.store.save();
            await plugin.agent.updateEnabledTools(next);
          }),
      );
  }
}
