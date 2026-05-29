import {
  getFrontMatterInfo,
  normalizePath,
  parseYaml,
  Setting,
  TFile,
} from "obsidian";
import { discoverSkillFolders } from "@/harness/skills/discovery";
import type { SettingsTabContext } from "./types";

const MAX_DESCRIPTION_LENGTH = 160;

type SkillPreview = {
  status: "ok" | "warning";
  title: string;
  description: string;
};

export function renderSkillsSection(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName("Skills").setHeading();
  containerEl.createDiv({
    cls: "setting-item-description flint-settings-intro",
    text: "Skills are discovered automatically from every SKILL.md file in the vault. They are enabled by default; turn off the ones you do not want the agent to use.",
  });

  const folders = discoverSkillFolders(ctx.app);
  if (folders.length === 0) {
    containerEl.createDiv({
      cls: "setting-item-description flint-empty-state",
      text: "No skills found. Add a folder containing a SKILL.md file to the vault.",
    });
    return;
  }

  const disabled = new Set(
    ctx.plugin.store.settings.disabledSkills.map((path) => normalizePath(path)),
  );

  const listEl = containerEl.createDiv({ cls: "flint-skills-list" });
  for (const folder of folders) {
    renderSkillRow(ctx, listEl, folder, !disabled.has(folder));
  }
}

function renderSkillRow(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
  folder: string,
  enabled: boolean,
): void {
  const setting = new Setting(containerEl).setName(folder).addToggle((toggle) =>
    toggle.setValue(enabled).onChange((value) => {
      void setSkillEnabled(ctx, folder, value);
    }),
  );

  setting.descEl.createDiv({
    cls: "flint-skill-folder-path",
    text: folder,
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
  setting.descEl.empty();
  setting.descEl.createDiv({
    text: truncateDescription(preview.description),
    title: preview.description,
  });
  setting.descEl.createDiv({
    cls: "flint-skill-folder-path",
    text: folder,
  });
  setting.descEl.toggleClass("is-warning", preview.status === "warning");
}

async function readSkillPreview(
  ctx: SettingsTabContext,
  folder: string,
): Promise<SkillPreview> {
  const skillPath = normalizePath(`${folder}/SKILL.md`);
  const file = ctx.app.vault.getAbstractFileByPath(skillPath);
  if (!(file instanceof TFile)) {
    return {
      status: "warning",
      title: folder,
      description: "Missing SKILL.md in this folder.",
    };
  }

  try {
    const content = await ctx.app.vault.cachedRead(file);
    const frontMatterInfo = getFrontMatterInfo(content);
    if (!frontMatterInfo.exists) {
      return {
        status: "warning",
        title: folder,
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
        title: name.trim() || folder,
        description: "SKILL.md is missing a description.",
      };
    }

    return {
      status: "ok",
      title: name.trim() || folder.split("/").at(-1) || folder,
      description,
    };
  } catch (error) {
    console.error(error);
    return {
      status: "warning",
      title: folder,
      description: "Could not parse SKILL.md YAML frontmatter.",
    };
  }
}

async function setSkillEnabled(
  ctx: SettingsTabContext,
  folder: string,
  enabled: boolean,
): Promise<void> {
  const normalized = normalizePath(folder);
  const disabled = new Set(
    ctx.plugin.store.settings.disabledSkills.map((path) => normalizePath(path)),
  );
  if (enabled) disabled.delete(normalized);
  else disabled.add(normalized);
  ctx.plugin.store.settings.disabledSkills = [...disabled];
  await ctx.plugin.store.save();
  await ctx.plugin.agent.reloadSkills();
}

function truncateDescription(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}
