import {
  type AgentHarness,
  type AgentMessage,
  loadSkills,
  type Session,
  type Skill,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { type App, normalizePath } from "obsidian";
import { autoNameSession } from "@/chat/auto-name";
import {
  applyHarnessEvent,
  rebuildToolRunsFromMessages,
} from "@/chat/harness-events";
import { buildSessionStats } from "@/chat/session-stats";
import {
  defaultRenderBody,
  defaultRenderTitle,
} from "@/chat/tool-renderers/default-dom";
import { defaultRenderMarkdown } from "@/chat/tool-renderers/default-md";
import { exportConversationMarkdown } from "@/export/service";
import type { ObsidianExecutionEnv } from "@/harness/env";
import type { ModelRegistry } from "@/harness/model-registry";
import type {
  FlintSessionMetadata,
  ObsidianSessionRepo,
} from "@/harness/session";
import { discoverSkillFolders } from "@/harness/skills/discovery";
import type { ToolRenderAdapter } from "@/harness/tools";
import { toRenderAdapter } from "@/harness/tools";
import type {
  FlintSettings,
  SessionStats,
  SessionSummary,
  ToolRun,
} from "@/settings/types";
import { sessionNameFromMessages } from "@/settings/types";
import { createObsidianHarness, type ResolvedCredential } from "./harness";

type FlintSession = Session<FlintSessionMetadata>;

export interface AgentControllerDeps {
  app: App;
  env: ObsidianExecutionEnv;
  sessionRepo: ObsidianSessionRepo;
  modelRegistry: ModelRegistry;
  getSettings: () => FlintSettings;
  updateSettings: (patch: Partial<FlintSettings>) => Promise<void>;
  resolveCredential: (
    model: Model<Api>,
  ) => Promise<ResolvedCredential | undefined>;
  onStateChange: () => void;
}

export class AgentController {
  harness?: AgentHarness;
  session?: FlintSession;
  messages: AgentMessage[] = [];
  toolRuns = new Map<string, ToolRun>();
  toolsByName = new Map<string, ToolRenderAdapter>();
  isRunning = false;
  isAutoTitling = false;
  currentSessionPath = "";
  currentSessionId = "";
  private cachedSessionName?: string;
  skillsStale = false;
  private skills: Skill[] = [];
  private unsubscribeHarness?: () => void;

  constructor(private readonly deps: AgentControllerDeps) {}

  setSessionRepo(sessionRepo: ObsidianSessionRepo): void {
    this.deps.sessionRepo = sessionRepo;
  }

  getSessionTitle(): string {
    return this.cachedSessionName ?? "Flint";
  }

  getToolAdapter(name: string): ToolRenderAdapter | undefined {
    return this.toolsByName.get(name);
  }

  getSkills(): readonly Skill[] {
    return this.skills;
  }

  async createHarness(metadata?: FlintSessionMetadata): Promise<void> {
    this.unsubscribeHarness?.();
    const result = await createObsidianHarness(this.deps, metadata);
    this.harness = result.harness;
    this.session = result.session;
    this.currentSessionPath = result.currentSessionPath;
    this.currentSessionId = result.currentSessionId;

    this.toolsByName.clear();
    const defaults = {
      renderTitle: defaultRenderTitle,
      renderBody: defaultRenderBody,
      renderMarkdown: defaultRenderMarkdown,
    };
    for (const tool of result.tools) {
      this.toolsByName.set(tool.name, toRenderAdapter(tool, defaults));
    }

    await this.reloadSkills();

    this.unsubscribeHarness = this.harness.subscribe((event) => {
      this.handleHarnessEvent(event);
      if (event.type === "settled") {
        void this.maybeAutoTitleSession();
      }
    });
  }

  async sendPrompt(text: string): Promise<void> {
    if (!this.harness) await this.createHarness();
    const harness = this.harness;
    if (!harness) throw new Error("Harness not initialized");
    this.isRunning = true;
    this.deps.onStateChange();
    try {
      await harness.prompt(text);
    } finally {
      this.isRunning = false;
      this.deps.onStateChange();
    }
  }

  async steerPrompt(text: string): Promise<void> {
    if (!this.harness || !this.isRunning) {
      await this.sendPrompt(text);
      return;
    }
    await this.harness.steer(text);
  }

  async runSkill(name: string, additionalInstructions?: string): Promise<void> {
    if (this.isRunning)
      throw new Error("Cannot run a skill while Pi is running");
    if (!this.harness) await this.createHarness();
    const harness = this.harness;
    if (!harness) throw new Error("Harness not initialized");
    this.isRunning = true;
    this.deps.onStateChange();
    try {
      await harness.skill(name, additionalInstructions?.trim() || undefined);
    } finally {
      this.isRunning = false;
      this.deps.onStateChange();
    }
  }

  async compactSession(customInstructions?: string): Promise<void> {
    if (this.isRunning) throw new Error("Cannot compact while Pi is running");
    if (!this.harness || this.messages.length === 0) {
      throw new Error("No conversation to compact");
    }
    this.isRunning = true;
    this.deps.onStateChange();
    try {
      await this.harness.compact(customInstructions?.trim() || undefined);
    } finally {
      this.isRunning = false;
      this.deps.onStateChange();
    }
  }

  async abortChat(): Promise<void> {
    if (this.harness && this.isRunning) await this.harness.abort();
  }

  async renameSession(name: string): Promise<void> {
    if (!this.session) return;
    await this.session.appendSessionName(name);
    this.cachedSessionName = name;
    this.deps.onStateChange();
  }

  markSkillsStale(): void {
    if (this.skillsStale) return;
    this.skillsStale = true;
    this.deps.onStateChange();
  }

  async reloadHarness(): Promise<void> {
    if (this.isRunning) throw new Error("Cannot reload harness while running");
    if (!this.currentSessionPath) {
      await this.createHarness();
      this.skillsStale = false;
      this.deps.onStateChange();
      return;
    }

    const sessions = await this.deps.sessionRepo.list();
    const metadata = sessions.find(
      (session) => session.path === this.currentSessionPath,
    );
    if (!metadata)
      throw new Error(`Session not found: ${this.currentSessionPath}`);
    await this.createHarness(metadata);
    this.skillsStale = false;
    this.deps.onStateChange();
  }

  async resetChat(): Promise<void> {
    if (this.harness && this.isRunning) await this.harness.abort();
    this.unsubscribeHarness?.();
    this.unsubscribeHarness = undefined;
    this.harness = undefined;
    this.session = undefined;
    this.cachedSessionName = undefined;
    this.messages = [];
    this.toolRuns.clear();
    this.toolsByName.clear();
    this.isRunning = false;
    this.isAutoTitling = false;
    this.currentSessionPath = "";
    this.currentSessionId = "";
    this.skillsStale = false;
    this.deps.onStateChange();
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    const { model, thinkingLevel } =
      await this.deps.modelRegistry.setModelSelection(provider, modelId);
    if (this.harness) await this.harness.setModel(model);
    if (this.harness) await this.harness.setThinkingLevel(thinkingLevel);
    this.deps.onStateChange();
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    const next = await this.deps.modelRegistry.setThinkingLevel(level);
    if (this.harness) await this.harness.setThinkingLevel(next);
    this.deps.onStateChange();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const { sessionRepo } = this.deps;
    const sessions = await sessionRepo.list();
    const summaries: SessionSummary[] = [];
    for (const metadata of sessions) {
      try {
        const session = await sessionRepo.open(metadata);
        const context = await session.buildContext();
        const sessionName = await session.getSessionName();
        const name =
          sessionName ??
          sessionNameFromMessages(context.messages) ??
          metadata.createdAt;
        summaries.push({
          path: metadata.path,
          name,
          createdAt: metadata.createdAt,
          messageCount: context.messages.length,
        });
      } catch (_) {
        // corrupt session files are skipped
        void _;
      }
    }
    return summaries;
  }

  async resumeSession(path: string): Promise<void> {
    if (this.harness && this.isRunning) await this.harness.abort();
    const { sessionRepo } = this.deps;
    const allSessions = await sessionRepo.list();
    const metadata = allSessions.find((session) => session.path === path);
    if (!metadata) throw new Error(`Session not found: ${path}`);
    const session = await sessionRepo.open(metadata);
    const context = await session.buildContext();
    this.messages = context.messages;
    rebuildToolRunsFromMessages(this.toolRuns, context.messages);
    await this.createHarness(metadata);
    const sessionName = await this.session?.getSessionName();
    this.cachedSessionName = sessionName ?? undefined;
    this.deps.onStateChange();
  }

  async deleteSession(path: string): Promise<void> {
    if (this.harness && this.isRunning) await this.harness.abort();
    const { sessionRepo } = this.deps;
    const allSessions = await sessionRepo.list();
    const metadata = allSessions.find((session) => session.path === path);
    if (!metadata) throw new Error(`Session not found: ${path}`);
    await sessionRepo.delete(metadata);
    if (path === this.currentSessionPath) {
      this.harness = undefined;
      this.session = undefined;
      this.cachedSessionName = undefined;
      this.messages = [];
      this.toolRuns.clear();
      this.toolsByName.clear();
      this.isRunning = false;
      this.currentSessionPath = "";
      this.currentSessionId = "";
    }
    this.deps.onStateChange();
  }

  async exportCurrentConversation(): Promise<string> {
    if (this.isRunning) throw new Error("Cannot export while Pi is running");
    if (this.messages.length === 0)
      throw new Error("No conversation to export");
    return exportConversationMarkdown({
      app: this.deps.app,
      messages: this.messages,
      toolRuns: this.toolRuns,
      toolsByName: this.toolsByName,
      sessionId: this.currentSessionId,
      sessionPath: this.currentSessionPath,
      settings: this.deps.getSettings().exportSettings,
    });
  }

  getSessionStats(): SessionStats {
    return buildSessionStats(
      this.messages,
      this.deps.modelRegistry.getCurrentModel(),
    );
  }

  /** Try to auto-title the session after the first successful turn. */
  private async maybeAutoTitleSession(): Promise<void> {
    const session = this.session;
    if (!session) return;

    this.isAutoTitling = true;
    this.deps.onStateChange();

    const named = await autoNameSession(
      session,
      this.messages,
      this.deps.getSettings().autoNameSettings,
      {
        resolveCredential: (model) => this.deps.resolveCredential(model),
        getModel: (provider, modelId) =>
          this.deps.modelRegistry.getModel(provider, modelId),
        getCurrentModel: () => this.deps.modelRegistry.getCurrentModel(),
      },
    );

    if (named) {
      const sessionName = await session.getSessionName();
      if (sessionName) this.cachedSessionName = sessionName;
    }

    this.isAutoTitling = false;
    this.deps.onStateChange();
  }

  private handleHarnessEvent(
    event: Parameters<typeof applyHarnessEvent>[1],
  ): void {
    applyHarnessEvent(this, event);
    this.deps.onStateChange();
  }

  /** Re-scan configured skill folders and update harness resources. */
  async reloadSkills(): Promise<void> {
    const settings = this.deps.getSettings();
    const { env } = this.deps;
    const disabled = new Set(
      settings.disabledSkills.map((path) => normalizePath(path)),
    );
    const folders = discoverSkillFolders(this.deps.app).filter(
      (folder) => !disabled.has(normalizePath(folder)),
    );
    const { skills, diagnostics } = await loadSkills(env, folders);
    this.skills = skills;
    this.skillsStale = false;
    if (diagnostics.length > 0) {
      console.warn("Skill loading diagnostics:", diagnostics);
    }
    if (this.harness) {
      await this.harness.setResources({ skills: this.skills });
    }
    this.deps.onStateChange();
  }

  /** Update which tools are enabled on the active harness. */
  async updateEnabledTools(toolNames: string[]): Promise<void> {
    await this.deps.updateSettings({ enabledTools: toolNames });
    if (this.harness) {
      await this.harness.setActiveTools(toolNames);
    }
    this.deps.onStateChange();
  }
}
