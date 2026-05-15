import {
  getFrontMatterInfo,
  Notice,
  normalizePath,
  parseYaml,
  Setting,
  TFile,
} from "obsidian";
import { FileSuggest } from "@/settings/views/file-suggest";
import { FolderSuggest } from "@/settings/views/folder-suggest";
import type { SettingsTabContext } from "./types";

const MAX_DESCRIPTION_LENGTH = 120;

type SkillPreview =
  | { status: "empty"; title: string; description: string }
  | { status: "ok"; title: string; description: string }
  | { status: "warning"; title: string; description: string };

export function renderSkillsTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  const { plugin } = ctx;
  ctx.renderPageHeader(
    containerEl,
    "Configure prompts, AGENTS.md instructions, and skill folders.",
  );

  renderSystemPromptSetting(ctx, containerEl);
  renderAgentFileSetting(ctx, containerEl);

  new Setting(containerEl)
    .setName("Skills")
    .setHeading()
    .addButton((button) => {
      button
        .setButtonText("+")
        .setTooltip("Add skill folder")
        .setCta()
        .onClick(() => {
          void addSkillFolder(ctx);
        });
      button.buttonEl.addClass("flint-icon-button");
    });

  const folders = plugin.store.settings.skillFolders;
  if (folders.length === 0) {
    renderEmptySkillsState(containerEl);
    return;
  }

  folders.forEach((folder, index) => {
    renderSkillFolderRow(ctx, containerEl, folder, index);
  });
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
  new Setting(containerEl).setName("AGENTS.md file").setHeading();

  const setting = new Setting(containerEl)
    .setName("Instructions file")
    .setDesc("Vault path to an AGENTS.md file included in Pi's system prompt.")
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

function renderEmptySkillsState(containerEl: HTMLElement): void {
  containerEl.createDiv({
    cls: "setting-item-description flint-empty-state",
    text: "No skill folders selected. Use + to add a folder containing a SKILL.md file.",
  });
}

function renderSkillFolderRow(
  ctx: SettingsTabContext,
  parent: HTMLElement,
  folder: string,
  index: number,
): void {
  const setting = new Setting(parent)
    .setName(folder ? "Loading skill..." : "No skill folder selected")
    .setDesc(
      folder
        ? "Reading SKILL.md metadata."
        : "Choose a folder containing a direct SKILL.md file.",
    )
    .addText((text) => {
      text.setPlaceholder("Folder").setValue(folder);
      text.inputEl.addClass("flint-skill-folder-input");
      text.inputEl.addEventListener("blur", () => {
        void setSkillFolder(ctx, index, text.getValue().trim());
      });
      new FolderSuggest(
        ctx.app,
        text.inputEl,
        (path) => {
          void setSkillFolder(ctx, index, path);
        },
        (suggestedFolder) => {
          const skillPath = normalizePath(`${suggestedFolder.path}/SKILL.md`);
          const hasSkill =
            ctx.app.vault.getAbstractFileByPath(skillPath) instanceof TFile;
          const alreadySelected = ctx.plugin.store.settings.skillFolders.some(
            (selected, selectedIndex) =>
              selectedIndex !== index &&
              normalizePath(selected) === normalizePath(suggestedFolder.path),
          );
          return hasSkill && !alreadySelected;
        },
      );
    })
    .addButton((button) => {
      button
        .setButtonText("-")
        .setTooltip("Remove skill folder")
        .onClick(() => {
          void removeSkillFolder(ctx, index);
        });
      button.buttonEl.addClass("flint-icon-button");
    });

  void updateSkillPreview(ctx, setting, folder);
}

async function updateSkillPreview(
  ctx: SettingsTabContext,
  setting: Setting,
  folder: string,
): Promise<void> {
  const preview = await readSkillPreview(ctx, folder);
  setting.setName(preview.title);
  const description = truncateDescription(preview.description);
  setting.setDesc(description);
  setting.descEl.addClass(`is-${preview.status}`);
  if (description !== preview.description)
    setting.descEl.title = preview.description;
}

async function readSkillPreview(
  ctx: SettingsTabContext,
  folder: string,
): Promise<SkillPreview> {
  const trimmed = folder.trim();
  if (!trimmed) {
    return {
      status: "empty",
      title: "No skill folder selected",
      description: "Choose a folder containing a direct SKILL.md file.",
    };
  }

  const skillPath = normalizePath(`${trimmed}/SKILL.md`);
  const file = ctx.app.vault.getAbstractFileByPath(skillPath);
  if (!(file instanceof TFile)) {
    return {
      status: "warning",
      title: trimmed,
      description: "Missing SKILL.md in this folder.",
    };
  }

  try {
    const content = await ctx.app.vault.cachedRead(file);
    const frontMatterInfo = getFrontMatterInfo(content);
    if (!frontMatterInfo.exists) {
      return {
        status: "warning",
        title: trimmed,
        description: "SKILL.md has no YAML frontmatter.",
      };
    }

    const frontmatter = parseYaml(frontMatterInfo.frontmatter) as Record<
      string,
      unknown
    >;
    const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
    const description =
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "";

    if (!description.trim()) {
      return {
        status: "warning",
        title: name.trim() || trimmed,
        description: "SKILL.md is missing a description.",
      };
    }

    return {
      status: "ok",
      title: name.trim() || trimmed.split("/").at(-1) || trimmed,
      description,
    };
  } catch (error) {
    console.error(error);
    return {
      status: "warning",
      title: trimmed,
      description: "Could not parse SKILL.md YAML frontmatter.",
    };
  }
}

async function setSkillFolder(
  ctx: SettingsTabContext,
  index: number,
  path: string,
): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) return;
  const folders = ctx.plugin.store.settings.skillFolders;
  if (
    folders.some(
      (folder, folderIndex) => folder === trimmed && folderIndex !== index,
    )
  ) {
    new Notice("Folder already added");
    return;
  }

  folders[index] = trimmed;
  await ctx.plugin.store.save();
  await ctx.plugin.agent.reloadSkills();
  ctx.display();
}

async function removeSkillFolder(
  ctx: SettingsTabContext,
  index: number,
): Promise<void> {
  ctx.plugin.store.settings.skillFolders.splice(index, 1);
  await ctx.plugin.store.save();
  await ctx.plugin.agent.reloadSkills();
  ctx.display();
}

async function addSkillFolder(ctx: SettingsTabContext): Promise<void> {
  ctx.plugin.store.settings.skillFolders.push("");
  await ctx.plugin.store.save();
  ctx.display();
}

function truncateDescription(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}
