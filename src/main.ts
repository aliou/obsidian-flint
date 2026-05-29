import "./styles.css";
import { registerBuiltInApiProviders } from "@earendil-works/pi-ai";
import {
  addIcon,
  normalizePath,
  Platform,
  Plugin,
  type TAbstractFile,
} from "obsidian";
import { AgentController } from "@/chat/controller";
import { DesktopFlintView, MobileFlintView } from "@/chat/view";
import { ObsidianExecutionEnv } from "@/harness/env";
import { ModelRegistry } from "@/harness/model-registry";
import { SecretManager } from "@/harness/secrets/manager";
import { ObsidianSessionRepo } from "@/harness/session";
import { FLINT_ICON } from "@/icon";
import { FlintSettingsStore } from "@/settings/store";
import { FlintSettingsTab } from "@/settings/tab";
import { VIEW_TYPE } from "@/settings/types";
import { noticeError } from "@/utils/errors";

export default class FlintPlugin extends Plugin {
  store!: FlintSettingsStore;
  agent!: AgentController;
  modelRegistry!: ModelRegistry;
  secrets!: SecretManager;
  settingTab?: FlintSettingsTab;
  private sessionRepo!: ObsidianSessionRepo;

  async onload(): Promise<void> {
    registerBuiltInApiProviders();
    addIcon("flint-logo", FLINT_ICON);
    this.store = new FlintSettingsStore(this);
    await this.store.load();
    this.modelRegistry = new ModelRegistry(this.store);
    this.secrets = new SecretManager(this.app, this.store);

    // Wire credential awareness so model selection respects configured providers.
    this.modelRegistry.setHasCredentialCheck((provider) =>
      this.secrets.hasCredential(provider),
    );
    this.secrets.setOnCredentialChange(
      () => void this.modelRegistry.ensureConfiguredSelection(),
    );
    await this.modelRegistry.ensureConfiguredSelection();

    this.sessionRepo = new ObsidianSessionRepo(
      this.app,
      this.store.settings.sessionStoragePath,
    );

    this.registerView(VIEW_TYPE, (leaf) =>
      Platform.isMobile
        ? new MobileFlintView(leaf, this)
        : new DesktopFlintView(leaf, this),
    );
    this.settingTab = new FlintSettingsTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addRibbonIcon("flint-logo", "Flint", () => void this.openView());
    this.addCommand({
      id: "open-flint",
      name: "Open Flint",
      callback: () => void this.openView(),
    });

    this.agent = new AgentController({
      app: this.app,
      env: new ObsidianExecutionEnv(this.app, { cwd: "/" }),
      sessionRepo: this.sessionRepo,
      modelRegistry: this.modelRegistry,
      getSettings: () => this.store.settings,
      updateSettings: (patch) => this.store.update(patch),
      resolveCredential: (model) => this.secrets.resolveCredential(model),
      onStateChange: () => this.store.notifyChange(),
    });
    this.modelRegistry.setModelSink(this.agent);
    void this.agent.reloadSkills().catch((error) => noticeError(error));
    this.addCommand({
      id: "export-flint-conversation",
      name: "Export Flint conversation",
      callback: () => void this.exportCurrentConversation(),
    });
    this.addCommand({
      id: "reload-flint-harness",
      name: "Reload Flint harness",
      callback: () =>
        void this.agent.reloadHarness().catch((error) => noticeError(error)),
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => {
        menu.addItem((item) => {
          item
            .setTitle("Export Flint conversation")
            .setIcon("download")
            .onClick(() => void this.exportCurrentConversation());
        });
      }),
    );
    this.registerSkillFileWatchers();
    this.store.onSessionStoragePathChange((path) => {
      this.sessionRepo = new ObsidianSessionRepo(this.app, path);
      this.agent.setSessionRepo(this.sessionRepo);
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private registerSkillFileWatchers(): void {
    const markIfAgentResourcePath = (
      file: TAbstractFile,
      oldPath?: string,
    ): void => {
      if (
        this.isAgentResourcePathWatched(file.path) ||
        (oldPath ? this.isAgentResourcePathWatched(oldPath) : false)
      ) {
        this.agent.markSkillsStale();
      }
    };

    this.registerEvent(
      this.app.vault.on("modify", (file) => markIfAgentResourcePath(file)),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => markIfAgentResourcePath(file)),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => markIfAgentResourcePath(file)),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        markIfAgentResourcePath(file, oldPath),
      ),
    );
  }

  private isAgentResourcePathWatched(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const agentFilePath = normalizePath(this.store.settings.agentFilePath);
    if (agentFilePath && normalizedPath === agentFilePath) return true;

    // Skills are auto-discovered from every SKILL.md in the vault, so any
    // SKILL.md change (create/modify/delete/rename) can affect the skill set.
    return (
      normalizedPath === "SKILL.md" || normalizedPath.endsWith("/SKILL.md")
    );
  }

  async exportCurrentConversation(): Promise<string | undefined> {
    try {
      return await this.agent.exportCurrentConversation();
    } catch (error) {
      noticeError(error);
      return undefined;
    }
  }

  private async openView(): Promise<void> {
    if (Platform.isPhone) {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      await this.app.workspace.revealLeaf(leaf);
      return;
    }

    const leaf = await this.app.workspace.ensureSideLeaf(VIEW_TYPE, "right", {
      active: true,
      reveal: true,
    });
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
