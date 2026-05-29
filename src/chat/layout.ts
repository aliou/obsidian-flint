import type { Workspace } from "obsidian";

const CSS_CHANGE_DEBOUNCE_MS = 600;

/**
 * Handles layout clearance for Obsidian chrome that can overlap chat views.
 */
export class ChatViewLayout {
  private debounceTimer?: number;
  private cssChangeRef?: ReturnType<Workspace["on"]>;
  private resizeRef?: ReturnType<Workspace["on"]>;
  private activeLeafRef?: ReturnType<Workspace["on"]>;
  private keyboardObserver?: MutationObserver;
  private keyboardDrawerEl?: HTMLElement;
  private keyboardLeafEl?: HTMLElement;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly workspace: Workspace,
  ) {
    this.containerEl.classList.add(
      this.isMobile()
        ? "flint-chat-layout-mobile"
        : "flint-chat-layout-desktop",
    );
    this.syncLayoutMode();
    this.syncMobileActiveChrome();
    this.syncStatusBarClearance();
    this.setupMobileKeyboardObserver();
    this.cssChangeRef = this.workspace.on("css-change", () => {
      if (this.debounceTimer != null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(
        () => this.syncStatusBarClearance(),
        CSS_CHANGE_DEBOUNCE_MS,
      );
    });
    this.resizeRef = this.workspace.on("resize", () =>
      this.syncStatusBarClearance(),
    );
    this.activeLeafRef = this.workspace.on("active-leaf-change", () => {
      this.syncMobileActiveChrome();
      this.syncStatusBarClearance();
    });
  }

  destroy(): void {
    this.containerEl.classList.remove(
      "flint-chat-layout-mobile",
      "flint-chat-layout-desktop",
      "flint-chat-layout-main",
      "flint-chat-layout-drawer",
    );
    if (this.debounceTimer != null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.cssChangeRef) {
      this.workspace.offref(this.cssChangeRef);
      this.cssChangeRef = undefined;
    }
    if (this.resizeRef) {
      this.workspace.offref(this.resizeRef);
      this.resizeRef = undefined;
    }
    if (this.activeLeafRef) {
      this.workspace.offref(this.activeLeafRef);
      this.activeLeafRef = undefined;
    }
    this.containerEl.doc.body.classList.remove("flint-chat-mobile-active");
    this.keyboardObserver?.disconnect();
    this.keyboardObserver = undefined;
    this.keyboardDrawerEl?.classList.remove("flint-chat-keyboard-open");
    this.keyboardDrawerEl = undefined;
    this.keyboardLeafEl?.classList.remove(
      "flint-chat-keyboard-open",
      "flint-chat-keyboard-open-main",
    );
    this.keyboardLeafEl = undefined;
  }

  syncStatusBarClearance(): void {
    const viewContent =
      this.containerEl.querySelector<HTMLElement>(".view-content");
    if (!viewContent) return;

    if (this.isMobile()) {
      this.syncLayoutMode();
      this.setClearance(viewContent, 0);
      viewContent.style.setProperty(
        "--flint-chat-mobile-nav-clearance",
        `${this.measureMobileNavClearance()}px`,
      );
      return;
    }

    const statusBar =
      this.containerEl.doc.querySelector<HTMLElement>(".status-bar");
    if (!statusBar) {
      this.setClearance(viewContent, 0);
      return;
    }

    this.setClearance(viewContent, 0);
    const overlap =
      viewContent.getBoundingClientRect().bottom -
      statusBar.getBoundingClientRect().top;
    if (overlap <= 0) return;

    const style = getComputedStyle(statusBar);
    const hidden =
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) === 0;
    this.setClearance(viewContent, hidden ? 0 : Math.ceil(overlap));
  }

  private setupMobileKeyboardObserver(): void {
    if (!this.isMobile()) return;

    const syncKeyboardClass = () => {
      const leaf = this.containerEl;
      const drawer = this.containerEl.closest<HTMLElement>(".workspace-drawer");
      if (this.keyboardDrawerEl && this.keyboardDrawerEl !== drawer) {
        this.keyboardDrawerEl.classList.remove("flint-chat-keyboard-open");
      }
      if (this.keyboardLeafEl && this.keyboardLeafEl !== leaf) {
        this.keyboardLeafEl.classList.remove(
          "flint-chat-keyboard-open",
          "flint-chat-keyboard-open-main",
        );
      }
      this.keyboardDrawerEl = drawer ?? undefined;
      this.keyboardLeafEl = leaf;

      const isDrawerActive = !!this.containerEl.closest(
        ".workspace-drawer-active-tab-content",
      );
      const keyboardHeight = parseFloat(
        this.containerEl.doc.documentElement.style.getPropertyValue(
          "--keyboard-height",
        ) || "0",
      );
      const keyboardOpen = keyboardHeight > 0;
      drawer?.classList.toggle(
        "flint-chat-keyboard-open",
        isDrawerActive && keyboardOpen,
      );
      leaf.classList.toggle("flint-chat-keyboard-open", keyboardOpen);
      leaf.classList.toggle(
        "flint-chat-keyboard-open-main",
        !drawer && keyboardOpen,
      );
      this.syncLayoutMode();
      this.syncStatusBarClearance();
    };

    this.keyboardObserver = new MutationObserver(syncKeyboardClass);
    this.keyboardObserver.observe(this.containerEl.doc.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    syncKeyboardClass();
  }

  private syncLayoutMode(): void {
    const inDrawer = !!this.containerEl.closest(".workspace-drawer");
    this.containerEl.classList.toggle("flint-chat-layout-drawer", inDrawer);
    this.containerEl.classList.toggle("flint-chat-layout-main", !inDrawer);
  }

  private syncMobileActiveChrome(): void {
    if (!this.isMobile()) return;
    const isActive =
      this.workspace.activeLeaf?.view.containerEl === this.containerEl;
    this.containerEl.doc.body.classList.toggle(
      "flint-chat-mobile-active",
      isActive,
    );
  }

  private measureMobileNavClearance(): number {
    const keyboardHeight = parseFloat(
      this.containerEl.doc.documentElement.style.getPropertyValue(
        "--keyboard-height",
      ) || "0",
    );
    if (keyboardHeight > 0) return 0;

    const nav =
      this.containerEl.doc.querySelector<HTMLElement>(".mobile-navbar");
    if (!nav) return 0;

    const style = getComputedStyle(nav);
    if (style.display === "none" || style.visibility === "hidden") return 0;

    const rect = nav.getBoundingClientRect();
    if (rect.height <= 0) return 0;

    return Math.max(0, Math.ceil(window.innerHeight - rect.top + 8));
  }

  private isMobile(): boolean {
    return this.containerEl.doc.body.classList.contains("is-mobile");
  }

  private setClearance(viewContent: HTMLElement, px: number): void {
    viewContent.style.setProperty(
      "--flint-chat-status-bar-clearance",
      `${px}px`,
    );
  }
}
