import { normalizePath, Setting } from "obsidian";
import { FolderSuggest } from "@/settings/views/folder-suggest";
import type { SettingsTabContext } from "./types";

export function renderAdvancedTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  ctx.renderPageHeader(
    containerEl,
    "Advanced settings for sessions, compaction, and storage.",
  );

  new Setting(containerEl).setName("Session storage").setHeading();
  new Setting(containerEl)
    .setName("Storage path")
    .setDesc(
      "Vault-relative path where session files are stored. Changing this takes effect on the next new session. Existing sessions remain accessible.",
    )
    .addText((text) => {
      text.setPlaceholder("Flint/Sessions");
      text.setValue(plugin.store.settings.sessionStoragePath);
      new FolderSuggest(ctx.app, text.inputEl, (path) => {
        void updateSessionStoragePath(ctx, path);
      });
      text.onChange(async (value) => {
        await updateSessionStoragePath(ctx, value);
      });
    });

  new Setting(containerEl).setName("Compaction").setHeading();
  new Setting(containerEl)
    .setName("Enable compaction")
    .setDesc("Allow automatic compaction of session history.")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.store.settings.compactionSettings.enabled)
        .onChange(async (val) => {
          plugin.store.settings.compactionSettings.enabled = val;
          await plugin.store.save();
        }),
    );

  new Setting(containerEl)
    .setName("Reserve tokens")
    .setDesc("Tokens reserved for the compaction summary prompt and output.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.setValue(
        String(plugin.store.settings.compactionSettings.reserveTokens),
      );
      text.onChange(async (val) => {
        const n = Number.parseInt(val, 10);
        if (!Number.isNaN(n) && n >= 0) {
          plugin.store.settings.compactionSettings.reserveTokens = n;
          await plugin.store.save();
        }
      });
    });

  new Setting(containerEl)
    .setName("Keep recent tokens")
    .setDesc("Approximate recent-context tokens to retain after compaction.")
    .addText((text) => {
      text.inputEl.type = "number";
      text.setValue(
        String(plugin.store.settings.compactionSettings.keepRecentTokens),
      );
      text.onChange(async (val) => {
        const n = Number.parseInt(val, 10);
        if (!Number.isNaN(n) && n >= 0) {
          plugin.store.settings.compactionSettings.keepRecentTokens = n;
          await plugin.store.save();
        }
      });
    });

  new Setting(containerEl)
    .setName("Compaction custom prompt")
    .setDesc(
      "Optional custom instructions appended to the compaction summary prompt.",
    )
    .setClass("flint-stacked-setting")
    .addTextArea((text) => {
      text.inputEl.style.width = "100%";
      text.inputEl.rows = 4;
      text.setValue(plugin.store.settings.compactionCustomPrompt);
      text.onChange(async (value) => {
        plugin.store.settings.compactionCustomPrompt = value;
        await plugin.store.save();
      });
    });
}

async function updateSessionStoragePath(
  ctx: SettingsTabContext,
  value: string,
): Promise<void> {
  const normalized = normalizePath(value.trim());
  if (!normalized || normalized === "/") return;
  try {
    await ctx.plugin.store.update({ sessionStoragePath: normalized });
  } catch (error) {
    ctx.notice(error);
  }
}
