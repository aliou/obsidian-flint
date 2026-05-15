import { type App, type IconName, PluginSettingTab } from "obsidian";
import type FlintPlugin from "@/main";
import { noticeError } from "@/utils/errors";
import { renderAdvancedTab } from "./tabs/advanced";
import { renderChatTab } from "./tabs/chat";
import { renderExportsTab } from "./tabs/exports";
import { type ProvidersTabState, renderProvidersTab } from "./tabs/providers";
import { renderSkillsTab } from "./tabs/skills";
import { renderToolsTab } from "./tabs/tools";
import type { SettingsPageId, SettingsTabContext } from "./tabs/types";

export class FlintSettingsTab extends PluginSettingTab {
  icon: IconName = "flint-logo";

  private activePage: SettingsPageId = "chat";
  private providersState: ProvidersTabState = {
    builtinSearch: "",
    expandedBuiltinProvider: null,
    customProviderFilter: "",
  };

  constructor(
    app: App,
    private readonly plugin: FlintPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("flint-settings-page");
    containerEl.createEl("h2", { text: "Flint" });
    this.renderNavigation(containerEl);

    const ctx = this.context();
    if (this.activePage === "chat") renderChatTab(ctx, containerEl);
    else if (this.activePage === "skills") renderSkillsTab(ctx, containerEl);
    else if (this.activePage === "tools") renderToolsTab(ctx, containerEl);
    else if (this.activePage === "exports") renderExportsTab(ctx, containerEl);
    else if (this.activePage === "advanced")
      renderAdvancedTab(ctx, containerEl);
    else renderProvidersTab(ctx, containerEl, this.providersState);
  }

  private context(): SettingsTabContext {
    return {
      app: this.app,
      plugin: this.plugin,
      display: () => this.display(),
      notice: (error) => noticeError(error),
      renderPageHeader: (containerEl, description) =>
        this.renderPageHeader(containerEl, description),
    };
  }

  private renderNavigation(containerEl: HTMLElement): void {
    const nav = containerEl.createDiv("flint-settings-nav");
    this.addNavButton(nav, "chat", "Chat");
    this.addNavButton(nav, "skills", "Prompts");
    this.addNavButton(nav, "tools", "Tools");
    this.addNavButton(nav, "exports", "Exports");
    this.addNavButton(nav, "advanced", "Advanced");
    this.addNavButton(nav, "providers", "Providers");
  }

  private addNavButton(
    parent: HTMLElement,
    page: SettingsPageId,
    label: string,
  ): void {
    const button = parent.createEl("button", {
      text: label,
      cls: this.activePage === page ? "is-active" : "",
    });
    button.addEventListener("click", () => {
      this.activePage = page;
      this.display();
    });
  }

  private renderPageHeader(
    containerEl: HTMLElement,
    description: string,
  ): void {
    containerEl.createEl("p", {
      cls: "setting-item-description flint-settings-intro",
      text: description,
    });
  }
}
