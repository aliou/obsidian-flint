import {
  type App,
  type IconName,
  normalizePath,
  PluginSettingTab,
  type SettingDefinitionItem,
} from "obsidian";
import type FlintPlugin from "@/main";
import {
  advancedSettingDefinitions,
  setCompactionSetting,
} from "./tabs/advanced";
import { autoNameSettingDefinitions } from "./tabs/auto-name";
import { contextSettingDefinitions } from "./tabs/context";
import { exportSettingDefinitions, setExportSetting } from "./tabs/exports";
import { modelSettingDefinitions } from "./tabs/model";
import { providerSettingDefinitions } from "./tabs/providers";
import { setToolEnabled, toolsSettingDefinitions } from "./tabs/tools";

export class FlintSettingsTab extends PluginSettingTab {
  icon: IconName = "flint-logo";

  constructor(
    app: App,
    private readonly plugin: FlintPlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "page",
        name: "Model",
        desc: "Active model, reasoning level, and providers.",
        items: [
          ...modelSettingDefinitions(this.plugin),
          {
            type: "page",
            name: "Providers",
            desc: "Built-in and custom OpenAI-compatible providers.",
            items: providerSettingDefinitions(this.app, this.plugin),
          },
        ],
      },
      {
        type: "page",
        name: "Context",
        desc: "System prompt, instructions file, and empty-state prompts.",
        items: contextSettingDefinitions(this.app, this.plugin),
      },
      {
        type: "page",
        name: "Tools & Hooks",
        desc: "Toggle vault tools and configure hooks.",
        items: [
          {
            type: "page",
            name: "Vault tools",
            desc: "Toggle which vault tools the agent can use.",
            items: toolsSettingDefinitions(),
          },
          {
            type: "page",
            name: "Auto-name sessions",
            desc: "Automatically name sessions after the first turn.",
            items: autoNameSettingDefinitions(this.plugin),
          },
        ],
      },
      {
        type: "page",
        name: "Exports",
        desc: "Markdown export output and formatting.",
        items: exportSettingDefinitions(),
      },
      {
        type: "page",
        name: "Advanced",
        desc: "Sessions, compaction, and other advanced options.",
        items: advancedSettingDefinitions(this.plugin),
      },
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.plugin.store.settings;
    if (key.startsWith("tool:")) {
      return settings.enabledTools.includes(key.slice("tool:".length));
    }

    switch (key) {
      case "systemPrompt":
        return settings.systemPrompt;
      case "agentFilePath":
        return settings.agentFilePath;
      case "emptyStateSuggestionsText":
        return settings.emptyStateSuggestions.join("\n");
      case "export.outputDirectory":
        return settings.exportSettings.outputDirectory;
      case "export.includeReasoning":
        return settings.exportSettings.includeReasoning;
      case "export.includeToolCalls":
        return settings.exportSettings.includeToolCalls;
      case "sessionStoragePath":
        return settings.sessionStoragePath;
      case "compaction.enabled":
        return settings.compactionSettings.enabled;
      case "compaction.reserveTokens":
        return settings.compactionSettings.reserveTokens;
      case "compaction.keepRecentTokens":
        return settings.compactionSettings.keepRecentTokens;
      case "compactionCustomPrompt":
        return settings.compactionCustomPrompt;
      case "autoName.enabled":
        return settings.autoNameSettings.enabled;
      case "autoName.prompt":
        return settings.autoNameSettings.prompt;
      default:
        return super.getControlValue(key);
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key.startsWith("tool:")) {
      await setToolEnabled(
        this.plugin,
        key.slice("tool:".length),
        Boolean(value),
      );
      return;
    }

    switch (key) {
      case "systemPrompt":
        await this.plugin.store.update({ systemPrompt: String(value) });
        this.plugin.store.notifyChange();
        return;
      case "agentFilePath":
        await this.plugin.store.update({ agentFilePath: String(value).trim() });
        this.plugin.agent.markSkillsStale();
        return;
      case "emptyStateSuggestionsText":
        await this.plugin.store.update({
          emptyStateSuggestions: String(value)
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        });
        return;
      case "export.outputDirectory":
        await setExportSetting(this.plugin, {
          outputDirectory: normalizePath(String(value).trim()),
        });
        return;
      case "export.includeReasoning":
        await setExportSetting(this.plugin, {
          includeReasoning: Boolean(value),
        });
        return;
      case "export.includeToolCalls":
        await setExportSetting(this.plugin, {
          includeToolCalls: Boolean(value),
        });
        return;
      case "sessionStoragePath":
        await this.plugin.store.update({
          sessionStoragePath: normalizePath(String(value).trim()),
        });
        return;
      case "compaction.enabled":
        await setCompactionSetting(this.plugin, "enabled", Boolean(value));
        return;
      case "compaction.reserveTokens":
        await setCompactionSetting(this.plugin, "reserveTokens", Number(value));
        return;
      case "compaction.keepRecentTokens":
        await setCompactionSetting(
          this.plugin,
          "keepRecentTokens",
          Number(value),
        );
        return;
      case "compactionCustomPrompt":
        await this.plugin.store.update({
          compactionCustomPrompt: String(value),
        });
        return;
      case "autoName.enabled":
        this.plugin.store.settings.autoNameSettings.enabled = Boolean(value);
        await this.plugin.store.save();
        return;
      case "autoName.prompt":
        this.plugin.store.settings.autoNameSettings.prompt = String(value);
        await this.plugin.store.save();
        return;
      default:
        await super.setControlValue(key, value);
    }
  }
}
