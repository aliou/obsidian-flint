import {
  type App,
  type IconName,
  PluginSettingTab,
  type SettingDefinitionItem,
  SettingPage,
} from "obsidian";
import type FlintPlugin from "@/main";
import { noticeError } from "@/utils/errors";
import { renderAdvancedTab } from "./tabs/advanced";
import { renderAutoNameTab } from "./tabs/auto-name";
import { renderContextTab } from "./tabs/context";
import { renderExportsTab } from "./tabs/exports";
import { modelSettingDefinitions } from "./tabs/model";
import { providerSettingDefinitions } from "./tabs/providers";
import { renderToolsTab } from "./tabs/tools";
import type { SettingsTabContext } from "./tabs/types";

type PageRenderer = (ctx: SettingsTabContext, containerEl: HTMLElement) => void;

/**
 * Imperative sub-page wrapper for Obsidian 1.13.0's navigable settings API.
 * Each page reuses an existing render function and rebuilds its own container
 * on re-render, so the legacy `(ctx, containerEl)` renderers keep working.
 */
class FlintSettingPage extends SettingPage {
  constructor(
    private readonly tab: FlintSettingsTab,
    title: string,
    private readonly render: PageRenderer,
  ) {
    super();
    this.title = title;
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.addClass("flint-settings-page");
    this.render(
      this.tab.pageContext(() => this.display()),
      this.containerEl,
    );
  }
}

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
        page: () => new FlintSettingPage(this, "Context", renderContextTab),
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
            page: () =>
              new FlintSettingPage(this, "Vault tools", renderToolsTab),
          },
          {
            type: "page",
            name: "Auto-name sessions",
            desc: "Automatically name sessions after the first turn.",
            page: () =>
              new FlintSettingPage(
                this,
                "Auto-name sessions",
                renderAutoNameTab,
              ),
          },
        ],
      },
      {
        type: "page",
        name: "Exports",
        desc: "Markdown export output and formatting.",
        page: () => new FlintSettingPage(this, "Exports", renderExportsTab),
      },
      {
        type: "page",
        name: "Advanced",
        desc: "Sessions, compaction, and other advanced options.",
        page: () => new FlintSettingPage(this, "Advanced", renderAdvancedTab),
      },
    ];
  }

  pageContext(refresh: () => void): SettingsTabContext {
    return {
      app: this.app,
      plugin: this.plugin,
      display: refresh,
      notice: (error) => noticeError(error),
      renderPageHeader: (containerEl, description) => {
        containerEl.createEl("p", {
          cls: "setting-item-description flint-settings-intro",
          text: description,
        });
      },
    };
  }
}
