import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  ItemView,
  Keymap,
  MarkdownRenderer,
  type Menu,
  normalizePath,
  setIcon,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  buildWikiLinkSuggestions,
  currentSlashToken,
  currentWikiLinkContext,
  decodeXmlValue,
  expandResolvedWikiLinks,
  parseSlashCommand,
  resolvedVaultPathForWikiLink,
  type SlashCommandSuggestion,
  splitMiddleText,
  type WikiLinkSuggestion,
} from "@/chat/composer-helpers";
import { ChatViewLayout } from "@/chat/layout";
import { ModelPickerModal } from "@/chat/model-picker-modal";
import type { ToolRenderContext } from "@/harness/tools";
import type FlintPlugin from "@/main";
import {
  contentText,
  findModel,
  formatCost,
  formatCount,
  formatDateTime,
  formatPercent,
  safeJson,
  type ToolRun,
  VIEW_TYPE,
} from "@/settings/types";
import { noticeError } from "@/utils/errors";

type ObsidianAppWithSetting = {
  setting?: {
    open: () => void;
    openTabById?: (id: string) => void;
  };
};

const OBSIDIAN_WIKILINK_RE =
  /<obsidian-wikilink\s+path="([^"]+)">([\s\S]*?)<\/obsidian-wikilink>/gu;

const SKILL_BLOCK_RE =
  /<skill name="([^"]+)" location="([^"]+)">([\s\S]*?)<\/skill>(?:\n\n([\s\S]+))?/;

abstract class BaseFlintView extends ItemView {
  private unsubscribe?: () => void;
  private messagesEl?: HTMLElement;
  private historyEl?: HTMLElement;
  private composerEl?: HTMLElement;
  private inputEl?: HTMLTextAreaElement;
  private wikiLinkSuggestionsEl?: HTMLElement;
  private slashSuggestionsEl?: HTMLElement;
  private sendButton?: HTMLButtonElement;
  private cancelButton?: HTMLButtonElement;
  private clearButton?: HTMLButtonElement;
  private statsEl?: HTMLElement;
  private modelMetaEl?: HTMLElement;
  private mobileStatsEl?: HTMLElement;
  private mobileModelStateEl?: HTMLElement;
  private mobileModelChipEl?: HTMLButtonElement;
  private scrollButton?: HTMLButtonElement;
  private loadingEl?: HTMLElement;
  private loadingLabelEl?: HTMLElement;
  private loadingTimer?: number;
  private layout?: ChatViewLayout;
  private loadingFrame = 0;
  private toolExpansion = new Map<string, boolean>();
  private autoScroll = true;
  private renderRaf?: number;
  private activeScreen: "chat" | "history" = "chat";
  private slashSuggestions: SlashCommandSuggestion[] = [];
  private headerLabelEl?: HTMLElement;
  private selectedSlashSuggestion = 0;
  private wikiLinkSuggestions: WikiLinkSuggestion[] = [];
  private selectedWikiLinkSuggestion = 0;
  private resolvedWikiLinkPaths = new Map<string, string>();

  private static readonly LOADING_FRAMES = ["~", "≈", "∼", "≋"];

  protected abstract readonly viewClass: string;
  protected abstract readonly submitOnEnter: boolean;
  protected abstract readonly submitShortcutLabel: string;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: FlintPlugin,
  ) {
    super(leaf);
    this.icon = "flint-logo";
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.agent?.getSessionTitle() ?? "Flint";
  }

  protected async onOpen(): Promise<void> {
    this.containerEl.addClass(this.viewClass);
    this.contentEl.empty();
    this.contentEl.addClass("flint-chat-root");

    this.renderHeader();
    this.renderMobileStatus();
    this.renderMessagesContainer();
    this.renderComposer();
    this.layout = new ChatViewLayout(this.containerEl, this.app.workspace);

    this.unsubscribe = this.plugin.store.onChange(() => this.scheduleRender());
    this.render();
  }

  protected async onClose(): Promise<void> {
    this.containerEl.removeClass(this.viewClass);
    this.unsubscribe?.();
    this.stopLoadingTimer();
    this.layout?.destroy();
    this.layout = undefined;
    if (this.renderRaf != null) window.cancelAnimationFrame(this.renderRaf);
  }

  private scheduleRender(): void {
    if (this.renderRaf != null) return;
    this.renderRaf = window.requestAnimationFrame(() => {
      this.renderRaf = undefined;
      this.render();
      this.layout?.syncStatusBarClearance();
    });
  }

  private renderHeader(): void {
    const header = this.contentEl.createDiv("flint-chat-header");
    const title = header.createDiv("flint-chat-header-title");
    this.headerLabelEl = title.createSpan({
      cls: "flint-chat-header-label",
      text: this.plugin.agent?.getSessionTitle() ?? "Flint",
    });

    const actions = header.createDiv("flint-chat-header-actions");
    const historyBtn = actions.createEl("button", {
      cls: "flint-chat-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Session history",
        title: "Session history",
      },
    });
    setIcon(historyBtn, "history");
    historyBtn.addEventListener("click", () => this.showHistory());

    const exportBtn = actions.createEl("button", {
      cls: "flint-chat-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Export conversation",
        title: "Export conversation",
      },
    });
    setIcon(exportBtn, "download");
    exportBtn.addEventListener("click", () => this.exportConversation());

    const newBtn = actions.createEl("button", {
      cls: "flint-chat-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Start new conversation",
        title: "Start new conversation",
      },
    });
    setIcon(newBtn, "plus");
    newBtn.addEventListener("click", () => this.startNewConversation());
  }

  protected showHistory(): void {
    this.activeScreen = "history";
    this.render();
  }

  protected startNewConversation(): void {
    this.activeScreen = "chat";
    void this.plugin.agent.resetChat();
  }

  protected exportConversation(): void {
    void this.plugin.exportCurrentConversation();
  }

  private renderMobileStatus(): void {
    const status = this.contentEl.createDiv("flint-chat-mobile-status");
    this.mobileStatsEl = status.createDiv("flint-chat-mobile-session-state");
    this.mobileModelStateEl = status.createDiv("flint-chat-mobile-model-state");
  }

  private renderMessagesContainer(): void {
    const wrapper = this.contentEl.createDiv("flint-chat-messages-wrapper");
    this.messagesEl = wrapper.createDiv("flint-chat-messages");
    this.historyEl = wrapper.createDiv("flint-chat-history");
    this.historyEl.style.display = "none";
    this.scrollButton = wrapper.createEl("button", {
      cls: "flint-chat-scroll-bottom",
      attr: {
        type: "button",
        "aria-label": "Scroll to bottom",
        title: "Scroll to bottom",
      },
    });
    setIcon(this.scrollButton, "arrow-down");
    this.scrollButton.style.display = "none";
    this.scrollButton.addEventListener("click", () => {
      wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: "smooth" });
      this.autoScroll = true;
      this.updateScrollButton();
    });
    wrapper.addEventListener("scroll", () => {
      const distanceFromBottom =
        wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight;
      this.autoScroll = distanceFromBottom < 32;
      this.updateScrollButton();
    });
  }

  private renderComposer(): void {
    const composer = this.contentEl.createDiv("flint-chat-composer");
    this.composerEl = composer;

    this.loadingEl = composer.createDiv("flint-chat-loading");
    this.loadingEl.style.display = "none";
    this.loadingEl.createSpan({ cls: "flint-chat-loading-frame", text: "~" });
    this.loadingLabelEl = this.loadingEl.createSpan({
      cls: "flint-chat-loading-label",
      text: "inferring",
    });

    this.wikiLinkSuggestionsEl = composer.createDiv(
      "flint-chat-wikilink-suggestions",
    );
    this.wikiLinkSuggestionsEl.style.display = "none";

    this.slashSuggestionsEl = composer.createDiv(
      "flint-chat-slash-suggestions",
    );
    this.slashSuggestionsEl.style.display = "none";

    const form = composer.createEl("form", { cls: "flint-chat-input-shell" });

    this.inputEl = form.createEl("textarea", {
      cls: "flint-chat-input",
      attr: { rows: "3", placeholder: "Message..." },
    });
    this.inputEl.addEventListener("keydown", (event) => {
      if (this.handleWikiLinkSuggestionKeydown(event)) return;
      if (this.handleSlashSuggestionKeydown(event)) return;
      const isPlainEnter =
        this.submitOnEnter &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey;
      const isCommandEnter =
        !this.submitOnEnter &&
        event.key === "Enter" &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey);
      if (!isPlainEnter && !isCommandEnter) return;
      event.preventDefault();
      form.requestSubmit();
    });
    this.inputEl.addEventListener("input", () => {
      this.updateComposerButtons();
      this.renderComposerSuggestions();
    });

    const bar = form.createDiv("flint-chat-input-bar");
    this.mobileModelChipEl = bar.createEl("button", {
      cls: "flint-chat-model-chip",
      attr: {
        type: "button",
        "aria-label": "Select model",
        title: "Select model",
      },
    });
    this.mobileModelChipEl.addEventListener("click", () => {
      new ModelPickerModal(this.plugin).open();
    });

    this.clearButton = bar.createEl("button", {
      cls: "flint-chat-icon-btn flint-chat-clear",
      attr: {
        type: "button",
        "aria-label": "Clear input",
        title: "Clear input",
      },
    });
    setIcon(this.clearButton, "x");
    this.clearButton.addEventListener("click", () => {
      if (!this.inputEl) return;
      this.inputEl.value = "";
      this.inputEl.focus();
      this.updateComposerButtons();
    });

    this.cancelButton = bar.createEl("button", {
      cls: "flint-chat-icon-btn flint-chat-cancel",
      attr: {
        type: "button",
        "aria-label": "Stop generating",
        title: "Stop generating",
      },
    });
    setIcon(this.cancelButton, "stop-circle");
    this.cancelButton.addEventListener(
      "click",
      () => void this.plugin.agent.abortChat(),
    );

    this.sendButton = bar.createEl("button", {
      cls: "flint-chat-icon-btn flint-chat-send",
      attr: {
        type: "submit",
        "aria-label": `Send message (${this.submitShortcutLabel})`,
        title: `Send message (${this.submitShortcutLabel})`,
      },
    });
    setIcon(this.sendButton, "corner-down-left");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.inputEl?.value.trim();
      const isRunning = this.plugin.agent.isRunning;
      if (!text) {
        if (isRunning) void this.plugin.agent.abortChat();
        return;
      }
      if (this.inputEl) {
        this.inputEl.value = "";
        this.hideComposerSuggestions();
        this.updateComposerButtons();
      }
      this.autoScroll = true;
      const modelText = expandResolvedWikiLinks(
        text,
        this.resolvedWikiLinkPaths,
      );
      this.resolvedWikiLinkPaths.clear();
      const action = this.submitPromptText(modelText, isRunning);
      void action.catch((error) => noticeError(error));
    });

    const metaRow = composer.createDiv("flint-chat-meta-row");
    this.statsEl = metaRow.createDiv("flint-chat-session-state");
    this.modelMetaEl = metaRow.createDiv("flint-chat-model-state");

    setTimeout(() => this.inputEl?.focus(), 0);
    this.updateComposerButtons();
  }

  private async submitPromptText(
    text: string,
    isRunning: boolean,
  ): Promise<void> {
    const slash = parseSlashCommand(text);
    if (slash?.command === "compact") {
      await this.plugin.agent.compactSession(slash.args);
      return;
    }
    if (slash?.command === "reload") {
      if (this.plugin.agent.isRunning) return;
      await this.plugin.agent.reloadHarness();
      return;
    }
    if (slash?.command === "model") {
      new ModelPickerModal(this.plugin).open();
      return;
    }
    if (slash?.command === "skill") {
      await this.plugin.agent.runSkill(slash.name, slash.args);
      return;
    }
    if (slash?.command === "name") {
      const name = slash.args?.trim();
      if (name) await this.plugin.agent.renameSession(name);
      return;
    }
    await (isRunning
      ? this.plugin.agent.steerPrompt(text)
      : this.plugin.agent.sendPrompt(text));
  }

  private renderComposerSuggestions(): void {
    this.renderWikiLinkSuggestions();
    if (this.wikiLinkSuggestions.length > 0) {
      this.hideSlashSuggestions();
      return;
    }
    this.renderSlashSuggestions();
  }

  private hideComposerSuggestions(): void {
    this.hideWikiLinkSuggestions();
    this.hideSlashSuggestions();
  }

  private renderWikiLinkSuggestions(): void {
    if (!this.wikiLinkSuggestionsEl) return;
    const context = currentWikiLinkContext(this.inputEl);
    if (!context) {
      this.hideWikiLinkSuggestions();
      return;
    }

    this.wikiLinkSuggestions = buildWikiLinkSuggestions(
      this.app.vault,
      this.app.metadataCache,
      context.query,
    );
    if (this.wikiLinkSuggestions.length === 0) {
      this.hideWikiLinkSuggestions();
      return;
    }

    this.selectedWikiLinkSuggestion = Math.min(
      this.selectedWikiLinkSuggestion,
      this.wikiLinkSuggestions.length - 1,
    );
    this.wikiLinkSuggestionsEl.empty();
    this.wikiLinkSuggestionsEl.style.display = "";

    for (const [index, suggestion] of this.wikiLinkSuggestions.entries()) {
      const item = this.wikiLinkSuggestionsEl.createEl("button", {
        cls: "flint-chat-wikilink-suggestion",
        attr: { type: "button" },
      });
      item.toggleClass(
        "is-selected",
        index === this.selectedWikiLinkSuggestion,
      );
      const label = item.createSpan("flint-chat-wikilink-label");
      label.setAttr("title", suggestion.label);
      const labelParts = splitMiddleText(suggestion.label);
      label.createSpan({
        cls: "flint-chat-wikilink-label-start",
        text: labelParts.start,
      });
      label.createSpan({
        cls: "flint-chat-wikilink-label-end",
        text: labelParts.end,
      });
      item.createSpan({
        cls: "flint-chat-wikilink-description",
        text: suggestion.directory,
      });
      item.addEventListener("click", () => this.applyWikiLinkSuggestion(index));
    }
  }

  private handleWikiLinkSuggestionKeydown(event: KeyboardEvent): boolean {
    if (this.wikiLinkSuggestions.length === 0) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.hideWikiLinkSuggestions();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.selectedWikiLinkSuggestion =
        (this.selectedWikiLinkSuggestion +
          direction +
          this.wikiLinkSuggestions.length) %
        this.wikiLinkSuggestions.length;
      this.renderWikiLinkSuggestions();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.applyWikiLinkSuggestion(this.selectedWikiLinkSuggestion);
      return true;
    }
    return false;
  }

  private applyWikiLinkSuggestion(index: number): void {
    const suggestion = this.wikiLinkSuggestions[index];
    const context = currentWikiLinkContext(this.inputEl);
    if (!suggestion || !context || !this.inputEl) return;

    const before = this.inputEl.value.slice(0, context.start);
    const after = this.inputEl.value.slice(this.inputEl.selectionStart);
    const visibleLink = `[[${suggestion.target}]]`;
    this.resolvedWikiLinkPaths.set(
      suggestion.target,
      resolvedVaultPathForWikiLink(suggestion.file),
    );
    this.inputEl.value = `${before}${visibleLink}${after}`;
    const cursor = before.length + visibleLink.length;
    this.inputEl.selectionStart = cursor;
    this.inputEl.selectionEnd = cursor;
    this.inputEl.focus();
    this.hideWikiLinkSuggestions();
    this.updateComposerButtons();
  }

  private hideWikiLinkSuggestions(): void {
    this.wikiLinkSuggestions = [];
    this.selectedWikiLinkSuggestion = 0;
    this.wikiLinkSuggestionsEl?.empty();
    if (this.wikiLinkSuggestionsEl)
      this.wikiLinkSuggestionsEl.style.display = "none";
  }

  private buildSlashSuggestions(query: string): SlashCommandSuggestion[] {
    const normalized = query.toLowerCase().replace(/^\//, "");
    const commands: SlashCommandSuggestion[] = [
      {
        command: "/compact",
        label: "/compact",
        description: "Compact the current conversation",
        kind: "action",
      },
      {
        command: "/model",
        label: "/model",
        description: "Switch model or adjust thinking level",
        kind: "action",
      },
      {
        command: "/reload",
        label: "/reload",
        description: "Reload harness to pick up resource changes",
        kind: "action",
      },
      {
        command: "/name",
        label: "/name",
        description: "Rename the current session",
        kind: "action",
      },
      ...this.plugin.agent.getSkills().map((skill) => ({
        command: `/skill:${skill.name}`,
        label: `/skill:${skill.name}`,
        description: skill.description,
        kind: "skill" as const,
      })),
    ];
    return commands
      .filter((item) => item.command.toLowerCase().includes(normalized))
      .slice(0, 8);
  }

  private renderSlashSuggestions(): void {
    if (!this.slashSuggestionsEl) return;
    const token = currentSlashToken(this.inputEl);
    if (!token) {
      this.slashSuggestions = [];
      this.selectedSlashSuggestion = 0;
      this.slashSuggestionsEl.style.display = "none";
      this.slashSuggestionsEl.empty();
      return;
    }

    this.slashSuggestions = this.buildSlashSuggestions(token);
    if (this.slashSuggestions.length === 0) {
      this.selectedSlashSuggestion = 0;
      this.slashSuggestionsEl.style.display = "none";
      this.slashSuggestionsEl.empty();
      return;
    }

    this.selectedSlashSuggestion = Math.min(
      this.selectedSlashSuggestion,
      this.slashSuggestions.length - 1,
    );
    this.slashSuggestionsEl.empty();
    this.slashSuggestionsEl.style.display = "";

    for (const [index, suggestion] of this.slashSuggestions.entries()) {
      const item = this.slashSuggestionsEl.createEl("button", {
        cls: "flint-chat-slash-suggestion",
        attr: { type: "button" },
      });
      item.toggleClass("is-selected", index === this.selectedSlashSuggestion);
      item.createSpan({
        cls: "flint-chat-slash-label",
        text: suggestion.label,
      });
      item.createSpan({
        cls: "flint-chat-slash-description",
        text: suggestion.description,
      });
      item.addEventListener("click", () => this.applySlashSuggestion(index));
    }
  }

  private handleSlashSuggestionKeydown(event: KeyboardEvent): boolean {
    if (this.slashSuggestions.length === 0) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      this.slashSuggestions = [];
      this.slashSuggestionsEl?.empty();
      if (this.slashSuggestionsEl)
        this.slashSuggestionsEl.style.display = "none";
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.selectedSlashSuggestion =
        (this.selectedSlashSuggestion +
          direction +
          this.slashSuggestions.length) %
        this.slashSuggestions.length;
      this.renderSlashSuggestions();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      this.applySlashSuggestion(this.selectedSlashSuggestion);
      return true;
    }
    return false;
  }

  private applySlashSuggestion(index: number): void {
    const suggestion = this.slashSuggestions[index];
    if (!suggestion || !this.inputEl) return;
    this.inputEl.value = `${suggestion.command} `;
    this.inputEl.focus();
    this.inputEl.selectionStart = this.inputEl.value.length;
    this.inputEl.selectionEnd = this.inputEl.value.length;
    this.hideSlashSuggestions();
    this.updateComposerButtons();
  }

  private hideSlashSuggestions(): void {
    this.slashSuggestions = [];
    this.selectedSlashSuggestion = 0;
    this.slashSuggestionsEl?.empty();
    if (this.slashSuggestionsEl) this.slashSuggestionsEl.style.display = "none";
  }

  private render(): void {
    this.syncDisplayTitle();
    this.syncHeaderLabel();
    if (this.composerEl)
      this.composerEl.style.display =
        this.activeScreen === "history" ? "none" : "";
    this.renderMessages();
    this.renderHistoryPanel();
    this.renderLoading();
    this.renderStats();
    this.updateComposerButtons();
  }

  private syncDisplayTitle(): void {
    const title = this.getDisplayText();
    const titleEls =
      this.containerEl.querySelectorAll<HTMLElement>(".view-header-title");
    for (const titleEl of titleEls) titleEl.setText(title);
  }

  private syncHeaderLabel(): void {
    const title = this.plugin.agent?.getSessionTitle() ?? "Flint";
    if (this.headerLabelEl) this.headerLabelEl.textContent = title;
  }

  private renderStats(): void {
    const stats = this.plugin.agent.getSessionStats();
    const context =
      typeof stats.contextPercent === "number" &&
      typeof stats.contextWindow === "number"
        ? ` ${formatPercent(stats.contextPercent)}/${formatCount(stats.contextWindow)}`
        : "";
    const statsText = `$${formatCost(stats.cost)}${context}`;
    this.statsEl?.setText(statsText);
    this.mobileStatsEl?.setText(statsText);
    const selectedModel = findModel(
      this.plugin.store.settings.customProviders,
      this.plugin.store.settings.provider,
      this.plugin.store.settings.modelId,
      this.plugin.store.settings.providerAuth,
    );
    const modelName =
      selectedModel?.name || this.plugin.store.settings.modelId || "no model";
    const reasoning = selectedModel?.reasoning
      ? this.plugin.store.settings.thinkingLevel
      : "off";
    const provider = this.plugin.store.settings.provider || "no provider";
    const fullModelLabel = `${provider} · ${modelName} · ${reasoning}`;
    this.modelMetaEl?.setText(fullModelLabel);
    this.mobileModelStateEl?.setText(fullModelLabel);
    if (this.mobileModelChipEl) {
      const chipLabel =
        selectedModel?.name || this.plugin.store.settings.modelId || "model";
      this.mobileModelChipEl.setText(chipLabel);
      this.mobileModelChipEl.setAttr("title", fullModelLabel);
      this.mobileModelChipEl.setAttr("aria-label", fullModelLabel);
    }
  }

  private renderHistoryPanel(): void {
    if (!this.historyEl || !this.messagesEl || !this.scrollButton) return;
    const showingHistory = this.activeScreen === "history";
    this.historyEl.style.display = showingHistory ? "" : "none";
    this.messagesEl.style.display = showingHistory ? "none" : "";
    this.scrollButton.style.display = showingHistory
      ? "none"
      : this.scrollButton.style.display;
    if (!showingHistory) return;

    this.historyEl.empty();
    const header = this.historyEl.createDiv("flint-chat-history-header");
    const back = header.createEl("button", {
      cls: "flint-chat-icon-btn",
      attr: {
        type: "button",
        "aria-label": "Back to chat",
        title: "Back to chat",
      },
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => {
      this.activeScreen = "chat";
      this.render();
      this.inputEl?.focus();
    });
    header.createDiv({ cls: "flint-chat-history-title", text: "Sessions" });

    const body = this.historyEl.createDiv("flint-chat-history-body");
    body.createDiv({
      cls: "flint-chat-history-status",
      text: "Loading sessions...",
    });
    void this.populateHistory(body);
  }

  private async populateHistory(body: HTMLElement): Promise<void> {
    try {
      const allSessions = await this.plugin.agent.listSessions();
      const sessions = allSessions.filter(
        (session) => session.messageCount > 0,
      );
      body.empty();
      if (sessions.length === 0) {
        body.createDiv({
          cls: "flint-chat-history-empty",
          text: "No saved sessions yet.",
        });
        return;
      }
      const list = body.createDiv({
        cls: "flint-chat-history-list",
        attr: { role: "listbox", "aria-label": "Session history" },
      });
      for (const session of sessions) {
        const row = list.createDiv("flint-chat-history-row");
        row.toggleClass(
          "is-current",
          session.path === this.plugin.agent.currentSessionPath,
        );
        const load = row.createEl("button", {
          cls: "flint-chat-history-item",
          attr: {
            type: "button",
            role: "option",
            "aria-selected": String(
              session.path === this.plugin.agent.currentSessionPath,
            ),
          },
        });
        load.createDiv({ cls: "flint-chat-session-title", text: session.name });
        load.createDiv({
          cls: "flint-chat-session-meta",
          text: `${session.messageCount} msgs · ${formatDateTime(session.createdAt)}`,
        });
        load.addEventListener("click", () => {
          this.activeScreen = "chat";
          void this.plugin.agent
            .resumeSession(session.path)
            .then(() => this.inputEl?.focus())
            .catch((error) => noticeError(error));
        });

        const del = row.createEl("button", {
          cls: "flint-chat-icon-btn flint-chat-delete-session",
          attr: {
            type: "button",
            "aria-label": `Delete ${session.name}`,
            title: "Delete session",
          },
        });
        setIcon(del, "trash-2");
        del.addEventListener("click", () => {
          if (!window.confirm(`Delete session "${session.name}"?`)) return;
          void this.plugin.agent
            .deleteSession(session.path)
            .then(() => this.render())
            .catch((error) => noticeError(error));
        });
      }
    } catch (error) {
      console.error(error);
      body.empty();
      body.createDiv({
        cls: "flint-chat-history-status is-error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    const wrapper = this.messagesEl.parentElement;
    this.messagesEl.empty();

    if (this.activeScreen === "history") return;

    if (
      this.plugin.agent.messages.length === 0 &&
      !this.plugin.agent.isRunning
    ) {
      this.renderEmptyState();
      this.updateScrollButton();
      return;
    }

    const lastIndex = this.plugin.agent.messages.length - 1;
    for (const [index, message] of this.plugin.agent.messages.entries()) {
      this.renderMessage(message, index === lastIndex);
    }

    if (wrapper && this.autoScroll) wrapper.scrollTop = wrapper.scrollHeight;
    this.updateScrollButton();
  }

  private updateScrollButton(): void {
    const wrapper = this.messagesEl?.parentElement;
    if (!wrapper || !this.scrollButton) return;
    const distanceFromBottom =
      wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight;
    const show =
      distanceFromBottom >= 48 && this.plugin.agent.messages.length > 0;
    this.scrollButton.style.display = show ? "" : "none";
  }

  private renderMessage(message: AgentMessage, isLast: boolean): void {
    if (!this.messagesEl) return;
    const role = message.role;

    if (role === "user") {
      this.renderUserMessage(message.content);
      return;
    }

    if (role === "assistant" && Array.isArray(message.content)) {
      const group = this.messagesEl.createDiv("flint-chat-assistant");
      const isStreaming = isLast && this.plugin.agent.isRunning;
      const lastTextIndex = (() => {
        for (let index = message.content.length - 1; index >= 0; index -= 1) {
          if (message.content[index]?.type === "text") return index;
        }
        return -1;
      })();
      message.content.forEach((part, index) => {
        if (part.type === "text") {
          const useStreaming = isStreaming && index === lastTextIndex;
          if (useStreaming) this.renderStreamingText(group, part.text);
          else this.renderMarkdownBlock(group, part.text);
        } else if (part.type === "thinking") {
          this.renderThinking(group, part.thinking, !isStreaming);
        } else if (part.type === "toolCall") {
          this.renderToolCall(group, part.name, part.id, part.arguments);
        }
      });
      if (message.errorMessage)
        group.createDiv({
          cls: "flint-chat-error",
          text: message.errorMessage,
        });
      return;
    }

    if (role === "toolResult") return;

    const fallback = this.messagesEl.createDiv("flint-chat-assistant");
    this.renderMarkdownBlock(
      fallback,
      "content" in message ? contentText(message.content) : safeJson(message),
    );
  }

  private renderUserMessage(content: unknown): void {
    const text = Array.isArray(content)
      ? content
          .filter(
            (part): part is { type: "text"; text: string } =>
              part?.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text)
          .join("\n")
      : contentText(content);

    if (!text) return;

    const parsed = this.parseSkillBlock(text);
    if (parsed) {
      const skillEl = this.messagesEl?.createDiv("flint-chat-skill-invocation");
      if (!skillEl) return;
      this.renderSkillBlock(skillEl, parsed);
      if (parsed.userMessage) {
        const card = this.messagesEl?.createDiv("flint-chat-user-message");
        if (card) {
          const textEl = card.createDiv("flint-chat-user-text");
          this.renderUserText(textEl, parsed.userMessage);
        }
      }
      return;
    }

    const card = this.messagesEl?.createDiv("flint-chat-user-message");
    if (card) {
      const textEl = card.createDiv("flint-chat-user-text");
      this.renderUserText(textEl, text);
    }
  }

  private renderUserText(parent: HTMLElement, text: string): void {
    OBSIDIAN_WIKILINK_RE.lastIndex = 0;
    let cursor = 0;
    let match = OBSIDIAN_WIKILINK_RE.exec(text);
    while (match !== null) {
      if (match.index > cursor)
        parent.appendText(text.slice(cursor, match.index));
      this.renderObsidianWikilink(
        parent,
        decodeXmlValue(match[1] ?? ""),
        decodeXmlValue(match[2] ?? ""),
      );
      cursor = match.index + match[0].length;
      match = OBSIDIAN_WIKILINK_RE.exec(text);
    }
    if (cursor < text.length) parent.appendText(text.slice(cursor));
  }

  private renderObsidianWikilink(
    parent: HTMLElement,
    path: string,
    label: string,
  ): void {
    const linkPath = normalizePath(path.replace(/^\/+/, ""));
    const linkEl = parent.createEl("a", {
      cls: "internal-link",
      text: `[[${label}]]`,
      attr: {
        href: linkPath,
        "data-href": linkPath,
      },
    });

    this.registerDomEvent(linkEl, "click", (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      void this.app.workspace.openLinkText(
        linkPath,
        "",
        Keymap.isModEvent(event),
      );
    });
  }

  private parseSkillBlock(text: string): {
    name: string;
    location: string;
    content: string;
    userMessage: string | undefined;
  } | null {
    const match = text.match(SKILL_BLOCK_RE);
    if (!match) return null;
    return {
      name: match[1],
      location: match[2],
      content: match[3],
      userMessage: match[4]?.trim() || undefined,
    };
  }

  private renderSkillBlock(
    parent: HTMLElement,
    parsed: { name: string; content: string },
  ): void {
    const header = parent.createDiv("flint-chat-skill-header");
    const chevron = header.createDiv("flint-chat-skill-chevron");
    setIcon(chevron, "chevron-right");
    header.createDiv({
      cls: "flint-chat-skill-label",
      text: parsed.name,
    });
    const body = parent.createDiv("flint-chat-skill-body");
    const stripped = parsed.content.replace(/^---[\s\S]*?---\n*/, "");
    this.renderMarkdownBlock(body, stripped);
    header.addEventListener("click", () => {
      parent.classList.toggle("is-expanded");
    });
  }

  private renderEmptyState(): void {
    if (!this.messagesEl) return;
    const provider = this.plugin.store.settings.provider;
    const model = this.plugin.store.settings.modelId;
    const blocked =
      !provider || !model || !this.plugin.secrets.hasCredential(provider);
    const empty = this.messagesEl.createDiv("flint-chat-empty");
    const icon = empty.createDiv("flint-chat-empty-icon");
    setIcon(icon, blocked ? "alert-triangle" : "flint-logo");
    empty.createDiv({
      cls: "flint-chat-empty-title",
      text: blocked ? "Provider setup needed" : "What can I help with?",
    });
    empty.createDiv({
      cls: "flint-chat-empty-body",
      text: blocked
        ? `Configure credentials for ${provider || "a provider"} before starting a conversation.`
        : "Ask Flint to inspect, explain, or update notes and Bases in this vault.",
    });
    if (blocked) {
      const setup = empty.createEl("button", {
        cls: "flint-chat-primary-action",
        text: "Open settings",
        attr: { type: "button" },
      });
      setup.addEventListener("click", () => this.openSettings());
      return;
    }
    const suggestions = empty.createDiv("flint-chat-suggestions");
    for (const prompt of this.plugin.store.settings.emptyStateSuggestions) {
      const chip = suggestions.createEl("button", {
        cls: "flint-chat-suggestion",
        text: prompt,
        attr: { type: "button" },
      });
      chip.addEventListener("click", () => {
        if (!this.inputEl) return;
        this.inputEl.value = prompt;
        this.inputEl.focus();
        this.updateComposerButtons();
      });
    }
  }

  private openSettings(): void {
    const setting = (this.app as ObsidianAppWithSetting).setting;
    setting?.open();
    setting?.openTabById?.(this.plugin.manifest.id);
  }

  private renderMarkdownBlock(parent: HTMLElement, text: string): void {
    const block = parent.createDiv("flint-chat-markdown");
    void MarkdownRenderer.render(this.app, text, block, "", this).then(() => {
      this.linkVaultPaths(block);
      this.linkInternalLinks(block);
      this.wrapMarkdownTables(block);
    });
  }

  private linkVaultPaths(block: HTMLElement): void {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.includes("/")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest("a, button, code, pre, textarea")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

    const pathPattern = /(^|[\s(])(\/[^\n`'"<>()[\]{}]+)/g;
    for (const node of textNodes) {
      const text = node.textContent ?? "";
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let changed = false;

      for (const match of text.matchAll(pathPattern)) {
        const prefix = match[1] ?? "";
        const rawCandidate = match[2] ?? "";
        const start = match.index ?? 0;
        const pathStart = start + prefix.length;
        const resolved = this.longestVaultFilePathPrefix(rawCandidate);
        if (!resolved) continue;

        fragment.appendText(text.slice(lastIndex, pathStart));
        const link = fragment.createEl("a", {
          cls: "flint-chat-vault-path-link",
          text: resolved.displayPath,
          attr: { href: "#" },
        });
        link.addEventListener("click", (event) => {
          event.preventDefault();
          void this.app.workspace.getLeaf(false).openFile(resolved.file);
        });
        fragment.appendText(rawCandidate.slice(resolved.displayPath.length));
        lastIndex = start + rawCandidate.length;
        changed = true;
      }

      if (!changed) continue;
      fragment.appendText(text.slice(lastIndex));
      node.replaceWith(fragment);
    }
  }

  private longestVaultFilePathPrefix(
    candidate: string,
  ): { displayPath: string; file: TFile } | undefined {
    for (let end = candidate.length; end > 1; end -= 1) {
      const displayPath = candidate.slice(0, end).replace(/[.,;:!?]+$/, "");
      const file = this.app.vault.getAbstractFileByPath(
        displayPath.replace(/^\/+/, ""),
      );
      if (file instanceof TFile) return { displayPath, file };
    }
    return undefined;
  }

  private linkInternalLinks(block: HTMLElement): void {
    const links = block.querySelectorAll<HTMLAnchorElement>("a.internal-link");
    for (const link of links) {
      const href = link.getAttribute("data-href") ?? link.getAttribute("href");
      if (!href) continue;
      link.removeAttribute("target");
      link.removeAttribute("rel");
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void this.app.workspace.openLinkText(
          href,
          "",
          Keymap.isModEvent(event),
        );
      });
    }
  }

  private wrapMarkdownTables(block: HTMLElement): void {
    for (const table of Array.from(block.querySelectorAll("table"))) {
      if (table.closest(".flint-chat-markdown-table-scroll")) continue;
      const parent = table.parentElement;
      if (!parent) continue;
      const wrapper = document.createElement("div");
      wrapper.className = "flint-chat-markdown-table-scroll";
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  }

  private renderStreamingText(parent: HTMLElement, text: string): void {
    const block = parent.createDiv(
      "flint-chat-markdown flint-chat-streaming-text",
    );
    block.setText(text);
  }

  private renderThinking(
    parent: HTMLElement,
    text: string,
    isComplete: boolean,
  ): void {
    const details = parent.createEl("details", { cls: "flint-chat-thinking" });
    const summary = details.createEl("summary");
    summary.createSpan({
      cls: isComplete
        ? "flint-chat-thinking-label is-complete"
        : "flint-chat-thinking-label is-active",
      text: isComplete ? "Thinking ✓" : "Thinking…",
    });
    const body = details.createDiv("flint-chat-thinking-body");
    void MarkdownRenderer.render(this.app, text, body, "", this).then(() => {
      this.linkVaultPaths(body);
    });
  }

  private renderToolCall(
    parent: HTMLElement,
    name: string,
    id: string,
    args: unknown,
  ): void {
    const run = this.plugin.agent.toolRuns.get(id);
    const expanded = this.toolExpansion.get(id) ?? false;
    const status: ToolRun["status"] = run?.status ?? "running";
    const wrapper = parent.createDiv(`flint-chat-tool is-${status}`);
    const adapter = this.plugin.agent.getToolAdapter(name);

    const ctx: ToolRenderContext = {
      app: this.app,
      component: this,
      status,
      isMobile: this.viewClass === "flint-chat-view-mobile",
    };

    // --- Header (toggle button) ---
    const button = wrapper.createEl("button", {
      cls: "flint-chat-tool-toggle",
      attr: { type: "button", "aria-expanded": String(expanded) },
    });
    button.createSpan({
      cls: "flint-chat-tool-status",
      text: status === "running" ? "..." : status,
    });

    const headerContent = button.createSpan("flint-chat-tool-header-content");
    if (adapter) {
      const titleMd = adapter.renderTitle(args, status);
      void MarkdownRenderer.render(this.app, titleMd, headerContent, "", this);
    } else {
      headerContent.createSpan({ cls: "flint-chat-tool-name", text: name });
    }

    button.createSpan({
      cls: "flint-chat-tool-caret",
      text: expanded ? "▴" : "▾",
    });
    button.addEventListener("click", () => {
      this.toolExpansion.set(id, !expanded);
      this.scheduleRender();
    });

    if (!expanded) return;

    // --- Body (expanded details) ---
    const detailsEl = wrapper.createDiv("flint-chat-tool-details");
    if (adapter) {
      adapter.renderBody(detailsEl, args, run?.result, ctx);
    } else {
      // Fallback for tools not in the registry (old sessions, etc.)
      if (
        args &&
        typeof args === "object" &&
        Object.keys(args as Record<string, unknown>).length > 0
      ) {
        this.renderToolBody(detailsEl, "Arguments", safeJson(args));
      }
      if (run?.result !== undefined) {
        const text =
          typeof run.result === "string" ? run.result : safeJson(run.result);
        this.renderToolBody(
          detailsEl,
          status === "running"
            ? "Output (streaming)"
            : status === "error"
              ? "Error"
              : "Output",
          text,
          status === "error",
        );
      }
    }
  }

  private renderToolBody(
    parent: HTMLElement,
    label: string,
    text: string,
    isError = false,
  ): void {
    const section = parent.createDiv("flint-chat-tool-section");
    section.createDiv({ cls: "flint-chat-tool-section-title", text: label });
    section.createEl("pre", { cls: isError ? "is-error" : undefined, text });
  }

  private renderLoading(): void {
    if (!this.loadingEl) return;
    const agent = this.plugin.agent;
    if (agent.isRunning) {
      this.loadingEl.style.display = "";
      if (this.loadingLabelEl) this.loadingLabelEl.textContent = "inferring";
      this.startLoadingTimer();
    } else if (agent.isAutoTitling) {
      this.loadingEl.style.display = "";
      if (this.loadingLabelEl) this.loadingLabelEl.textContent = "titling";
      this.startLoadingTimer();
    } else {
      this.loadingEl.style.display = "none";
      this.stopLoadingTimer();
    }
  }

  private startLoadingTimer(): void {
    if (this.loadingTimer != null) return;
    this.loadingTimer = window.setInterval(() => {
      this.loadingFrame =
        (this.loadingFrame + 1) % BaseFlintView.LOADING_FRAMES.length;
      const frameEl = this.loadingEl?.querySelector(
        ".flint-chat-loading-frame",
      );
      if (frameEl)
        frameEl.textContent =
          BaseFlintView.LOADING_FRAMES[this.loadingFrame] ?? "~";
    }, 200);
  }

  private stopLoadingTimer(): void {
    if (this.loadingTimer != null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = undefined;
    }
  }

  private updateComposerButtons(): void {
    const hasText = (this.inputEl?.value.trim().length ?? 0) > 0;
    const isRunning = this.plugin.agent.isRunning;

    if (this.clearButton)
      this.clearButton.style.display = hasText ? "" : "none";
    if (this.cancelButton) this.cancelButton.style.display = "none";
    if (this.sendButton) {
      this.sendButton.empty();
      this.sendButton.style.display = "";
      this.sendButton.disabled = !hasText && !isRunning;
      this.sendButton.toggleClass("is-active", hasText || isRunning);
      if (isRunning && !hasText) {
        this.sendButton.setAttr("aria-label", "Stop generating");
        this.sendButton.setAttr("title", "Stop generating");
        setIcon(this.sendButton, "stop-circle");
      } else if (isRunning) {
        this.sendButton.setAttr(
          "aria-label",
          `Steer generation (${this.submitShortcutLabel})`,
        );
        this.sendButton.setAttr(
          "title",
          `Steer generation (${this.submitShortcutLabel})`,
        );
        setIcon(this.sendButton, "corner-down-left");
      } else {
        this.sendButton.setAttr(
          "aria-label",
          `Send message (${this.submitShortcutLabel})`,
        );
        this.sendButton.setAttr(
          "title",
          `Send message (${this.submitShortcutLabel})`,
        );
        setIcon(this.sendButton, "corner-down-left");
      }
    }
  }
}

export class DesktopFlintView extends BaseFlintView {
  protected readonly viewClass = "flint-chat-view-desktop";
  protected readonly submitOnEnter = true;
  protected readonly submitShortcutLabel = "Enter";
}

export class MobileFlintView extends BaseFlintView {
  protected readonly viewClass = "flint-chat-view-mobile";
  protected readonly submitOnEnter = false;
  protected readonly submitShortcutLabel = "Cmd+Enter";

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("Session history")
        .setIcon("history")
        .onClick(() => this.showHistory());
    });
    menu.addItem((item) => {
      item
        .setTitle("Export conversation")
        .setIcon("download")
        .onClick(() => this.exportConversation());
    });
    menu.addItem((item) => {
      item
        .setTitle("Start new conversation")
        .setIcon("plus")
        .onClick(() => this.startNewConversation());
    });
  }
}
