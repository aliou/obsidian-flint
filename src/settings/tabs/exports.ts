import { normalizePath, Setting } from "obsidian";
import type { FlintExportSettings } from "@/settings/types";
import { FolderSuggest } from "@/settings/views/folder-suggest";
import type { SettingsTabContext } from "./types";

export function renderExportsTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  ctx.renderPageHeader(
    containerEl,
    "Configure Markdown exports for Flint conversations.",
  );

  new Setting(containerEl).setName("Output").setHeading();
  new Setting(containerEl)
    .setName("Output directory")
    .setDesc(
      "Vault-relative folder where conversation export files are created.",
    )
    .addText((text) => {
      text.setPlaceholder("Flint Exports");
      text.setValue(plugin.store.settings.exportSettings.outputDirectory);
      new FolderSuggest(ctx.app, text.inputEl, (path) => {
        void updateExportSettings(ctx, { outputDirectory: path });
      });
      text.onChange(async (value) => {
        const normalized = normalizePath(value.trim());
        if (!normalized) return;
        await updateExportSettings(ctx, { outputDirectory: normalized });
      });
    });

  new Setting(containerEl).setName("Content").setHeading();
  new Setting(containerEl)
    .setName("Include reasoning")
    .setDesc("Include model reasoning blocks in Markdown exports.")
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.store.settings.exportSettings.includeReasoning)
        .onChange(async (value) => {
          await updateExportSettings(ctx, { includeReasoning: value });
        });
    });

  new Setting(containerEl)
    .setName("Include tool calls")
    .setDesc("Include tool call blocks in Markdown exports.")
    .addToggle((toggle) => {
      toggle
        .setValue(plugin.store.settings.exportSettings.includeToolCalls)
        .onChange(async (value) => {
          await updateExportSettings(ctx, { includeToolCalls: value });
        });
    });
}

async function updateExportSettings(
  ctx: SettingsTabContext,
  patch: Partial<FlintExportSettings>,
): Promise<void> {
  try {
    await ctx.plugin.store.update({
      exportSettings: {
        ...ctx.plugin.store.settings.exportSettings,
        ...patch,
      },
    });
  } catch (error) {
    ctx.notice(error);
  }
}
