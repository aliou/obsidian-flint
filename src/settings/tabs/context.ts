import { normalizePath, Setting, TFile } from "obsidian";
import { FileSuggest } from "@/settings/views/file-suggest";
import { renderSkillsSection } from "./skills";
import type { SettingsTabContext } from "./types";

export function renderContextTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  ctx.renderPageHeader(
    containerEl,
    "Shape how the agent behaves: system prompt, instructions file, and empty-state prompts.",
  );

  renderSystemPromptSetting(ctx, containerEl);
  renderAgentFileSetting(ctx, containerEl);
  renderSkillsSection(ctx, containerEl);
  renderEmptyStateSetting(ctx, containerEl);
}

function renderSystemPromptSetting(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName("System prompt").setHeading();
  new Setting(containerEl)
    .setName("Custom system prompt")
    .setDesc(
      "Optional text appended to the base system prompt. Supports dynamic context at turn start.",
    )
    .setClass("flint-stacked-setting")
    .addTextArea((text) => {
      text.inputEl.style.width = "100%";
      text.inputEl.rows = 6;
      text.setValue(ctx.plugin.store.settings.systemPrompt);
      text.onChange(async (value) => {
        ctx.plugin.store.settings.systemPrompt = value;
        await ctx.plugin.store.save();
        ctx.plugin.store.notifyChange();
      });
    });
}

function renderAgentFileSetting(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName("Instructions file").setHeading();

  const setting = new Setting(containerEl)
    .setName("AGENTS.md file")
    .setDesc("Vault path to an AGENTS.md file included in the system prompt.")
    .addText((text) => {
      text
        .setPlaceholder("Path to AGENTS.md")
        .setValue(ctx.plugin.store.settings.agentFilePath)
        .onChange((value) => {
          void setAgentFilePath(ctx, value.trim());
        });
      new FileSuggest(ctx.app, text.inputEl, (path) => {
        void setAgentFilePath(ctx, path);
      });
    });

  void updateAgentFilePreview(ctx, setting.descEl);
}

async function updateAgentFilePreview(
  ctx: SettingsTabContext,
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

async function setAgentFilePath(
  ctx: SettingsTabContext,
  path: string,
): Promise<void> {
  ctx.plugin.store.settings.agentFilePath = path;
  await ctx.plugin.store.save();
  ctx.plugin.agent.markSkillsStale();
}

function renderEmptyStateSetting(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName("Empty state").setHeading();
  new Setting(containerEl)
    .setName("Prompt suggestions")
    .setDesc(
      "Prompt chips shown before a conversation starts. Use one per line.",
    )
    .setClass("flint-stacked-setting")
    .addTextArea((text) => {
      text.inputEl.style.width = "100%";
      text.inputEl.rows = 4;
      text.setValue(ctx.plugin.store.settings.emptyStateSuggestions.join("\n"));
      text.onChange(async (value) => {
        const suggestions = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await ctx.plugin.store.update({ emptyStateSuggestions: suggestions });
      });
    });
}
