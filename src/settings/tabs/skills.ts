import {
  type App,
  getFrontMatterInfo,
  normalizePath,
  parseYaml,
  type Setting,
  type SettingDefinitionItem,
  TFile,
} from "obsidian";
import { discoverSkillFolders } from "@/harness/skills/discovery";
import type FlintPlugin from "@/main";

type SettingsDataContext = {
  app: App;
  plugin: FlintPlugin;
};

const MAX_DESCRIPTION_LENGTH = 160;

type SkillPreview = {
  status: "ok" | "warning";
  title: string;
  description: string;
};

export function skillsSettingDefinitions(
  app: App,
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  const folders = discoverSkillFolders(app);
  const disabled = new Set(
    plugin.store.settings.disabledSkills.map((path) => normalizePath(path)),
  );

  return [
    {
      type: "list",
      heading: "Skills",
      emptyState:
        "No skills found. Add a folder containing a SKILL.md file to the vault.",
      items: folders.map((folder) => ({
        name: folder,
        desc: folder,
        render: (setting: Setting) => {
          renderSkillSetting(
            { app, plugin },
            setting,
            folder,
            !disabled.has(folder),
          );
        },
      })),
    },
  ];
}

function renderSkillSetting(
  ctx: SettingsDataContext,
  setting: Setting,
  folder: string,
  enabled: boolean,
): void {
  setting.addToggle((toggle) =>
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
  ctx: SettingsDataContext,
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
  ctx: SettingsDataContext,
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
  ctx: SettingsDataContext,
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
