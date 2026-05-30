# AGENTS.md

Development notes for agents working on this Obsidian extension.

## Project overview

This repository builds the `flint` Obsidian plugin. It embeds Pi `AgentHarness` in an Obsidian sidebar and limits file access to the current vault through Obsidian's vault adapter.

Key files:

- `src/main.ts`: plugin lifecycle, settings persistence, view registration, fetch patch setup, skill file watchers, and export/rerun commands.
- `src/chat/controller.ts`: `AgentController` — chat state, harness lifecycle, session orchestration, skill loading, tool enable/disable, and export.
- `src/chat/harness.ts`: `createObsidianHarness()` — `AgentHarness` construction, model resolution, credential wiring, and system prompt builder.
- `src/chat/harness-events.ts`: `applyHarnessEvent()` and `rebuildToolRunsFromMessages()` — reactive state updates from harness event stream.
- `src/chat/session-stats.ts`: token/cost/context-window aggregation for session stats.
- `src/chat/composer-helpers.ts`: slash command parsing (`/compact`, `/reload`, `/skill:<name>`), wikilink suggestion building, and middle-truncation helpers.
- `src/chat/system-prompt.ts`: Obsidian-specific system prompt construction.
- `src/chat/view.ts`: sidebar chat UI (desktop and mobile view classes), composer autocomplete, slash commands, vault path links, and mobile status bar.
- `src/chat/layout.ts`: layout clearance for Obsidian chrome, mobile keyboard handling, status bar overlap.
- `src/chat/model-picker-modal.ts`: model picker modal with search, favorites, and thinking level.
- `src/chat/tool-renderers/`: default DOM and markdown tool renderers.
- `src/export/markdown.ts`: Markdown export builder (frontmatter, callouts, tool blocks).
- `src/export/service.ts`: Markdown export orchestration (file creation, folder setup, open-in-tab).
- `src/harness/env/`: Obsidian-backed `ExecutionEnv`.
- `src/harness/model-registry/index.ts`: `ModelRegistry` — provider/model registry, selection, favorites, custom provider CRUD, and credential-aware fallback.
- `src/harness/secrets/manager.ts`: Obsidian `SecretStorage` integration, credential resolution, and model discovery.
- `src/harness/skills/discovery.ts`: vault-wide `SKILL.md` folder scanning for skill auto-discovery.
- `src/harness/session/`: JSONL session storage under `Flint/Sessions` by default.
- `src/harness/tools/`: vault and Bases tools exposed to the agent, with per-tool DOM and markdown renderers.
- `src/harness/tools/guardrails.ts`: path validation, blocked-path checks, glob matching, property type inference, and text-readable extension set.
- `src/harness/tools/vault/`: vault content tools (`ls`, `read`, `write`, `mkdir`, `delete`, `find`, `search`).
- `src/harness/tools/base/`: Bases tools (`list_bases`, `query_base`) and Base file parsing/metadata helpers.
- `src/icon.ts`: `FLINT_ICON` SVG constant for the sidebar ribbon.
- `src/settings/store.ts`: `FlintSettingsStore` — settings load/save/update, change notifications, session path change listeners, and fetch shim refresh.
- `src/settings/tab.ts`: `FlintSettingsTab` — Obsidian 1.13+ navigable settings API with sub-pages.
- `src/settings/tabs/`: individual settings pages (model, context, tools, exports, advanced, providers, skills).
- `src/settings/types.ts`: `FlintSettings` type, default values, model/provider helpers, `ToolRun`, `SessionStats`, and formatting utilities.
- `src/settings/views/`: settings modals (`CustomProviderModal`, `ModelConfigModal`) and suggesters (`FileSuggest`, `FolderSuggest`).
- `src/shims/*`: browser/Obsidian-safe shims for Pi dependencies. See `docs/shims.md`.
- `src/utils/errors.ts`: error formatting helper.

## Commands

Run these before handing off code changes:

```bash
pnpm check
pnpm lint
pnpm build
```

Useful commands:

```bash
pnpm install
pnpm format
pnpm test
pnpm test:watch
```

The Nix flake provides Node.js 22 and git:

```bash
nix develop
```

## Build assumptions

Pi packages are npm dependencies. `vite.config.ts` maps Node-oriented Pi dependency imports to browser-safe Obsidian shims.

## Coding guidelines

- Use TypeScript strict mode patterns. Avoid `any`; prefer explicit local types.
- Keep Obsidian UI code imperative and simple. Use Obsidian DOM helpers where existing code does.
- Keep all vault paths normalized with Obsidian `normalizePath`.
- Treat paths shown to Pi as absolute-looking vault paths, such as `/Notes/file.md`.
- Do not add shell execution. `ObsidianExecutionEnv.exec` should remain unavailable.
- Do not expose `.obsidian` or `.pi` through tools. Keep `ObsidianExecutionEnv` path protections intact.
- Do not import Node built-ins at module top level for code that runs in Obsidian. Use shims or guarded runtime loading.
- Keep mobile/browser safety in mind. Desktop Obsidian is the primary target.
- Use `@/` imports for local source files.
- Follow Biome formatting and lint rules.

## Provider and credential notes

- Built-in providers come from `@earendil-works/pi-ai` after `registerBuiltInApiProviders()`.
- Custom providers are OpenAI-compatible and configured in plugin settings.
- Obsidian `SecretStorage` values are raw API keys, not serialized Pi auth objects.
- Built-in providers store secret links in `providerAuth` settings; custom providers store them in their `secretId` field.
- Providers marked as authless use the `OBSIDIAN_AUTHLESS_API_KEY` placeholder (`"obsidian-authless-provider"`). The fetch shim strips the `Authorization` header for those provider base URLs.
- The set of authless base URLs is refreshed dynamically via `store.refreshFetchPatch()` when provider settings change.
- Custom provider model discovery (`SecretManager.discoverOpenAIModels`) fetches `GET /models` using Obsidian `requestUrl`.

## Session notes

- Sessions are append-only JSONL files in `Flint/Sessions` by default (configurable via `sessionStoragePath` setting).
- The session storage setting uses a folder suggester and changing it affects new sessions and future history lookups.
- Session format is version 3 JSONL: header line with `{ type: "session", version: 3, id, timestamp }` followed by `SessionTreeEntry` lines.
- Corrupt session lines are intentionally skipped during reads.
- Session deletion is guarded to only remove `.jsonl` files under the configured session root.
- Session forking (branching from a specific entry) is supported by the session layer but not exposed in the UI yet.
- `AgentController.resumeSession()` rebuilds messages and tool runs from a stored session before creating a new harness.
- Compaction settings control automatic session history summarization: `enabled`, `reserveTokens`, `keepRecentTokens`, and optional `compactionCustomPrompt`.
- `/compact` in the composer manually runs compaction for the current session.

## Chat UI notes

- Composer slash command parsing lives in `src/chat/composer-helpers.ts`. Supported commands: `/compact` (manual compaction), `/reload` (rebuilds the harness to pick up resource changes), and `/skill:<name>` (calls `AgentHarness.skill()` with any trailing text as additional instructions).
- Composer wikilink suggestions trigger on `[[`, show above the input shell, list five files, display the filename with middle truncation, and show only the containing directory on the second line.
- The filename middle-truncation uses two spans and flexbox. Keep the suffix span whitespace-preserving so names split before spaces still render correctly.
- Empty chat prompt chips come from `emptyStateSuggestions` and are configured on the Chat settings page.
- Message text should remain selectable. Avoid adding `user-select: none` to message, markdown, thinking, or tool body content.
- Rendered assistant Markdown linkifies absolute vault paths outside code/pre/link/button elements and opens matching `TFile`s in Obsidian.
- Mobile hides the normal chat header and uses a compact top status bar for model and session stats.

## Export notes

- Conversations are exported as Markdown files with YAML frontmatter (models, start/end datetime).
- Tool calls are rendered as Obsidian callouts (`flint-tools`, `flint-tool-success`, `flint-tool-error`, `flint-tool-running`) when `exportSettings.includeToolCalls` is enabled.
- Thinking/reasoning is rendered as `flint-reasoning` callouts when `exportSettings.includeReasoning` is enabled.
- Export output directory is configurable (default `Flint Exports`).
- Each vault tool defines `renderTitle()`, `renderBody()`, and `renderMarkdown()` for both chat UI and export.

## Tool notes

- Each vault tool implements the `ObsidianTool` interface which extends `AgentTool` with optional `promptGuidelines`, `renderTitle`, `renderBody`, and `renderMarkdown`.
- `ToolRenderAdapter` (in `tool-render-types.ts`) erases the generic types and provides default fallbacks for tools without custom renderers. It also guards title rendering so old sessions with malformed arguments do not break chat rendering.
- `ToolRenderContext` passes `app`, `component`, `status`, and `isMobile` to DOM renderers.
- The `query_base` tool depends on `@aliou/obsdx-base-engine` for execution and `@aliou/obsdx-base-ast` for parsing and validation.
- `metadata.ts` provides `inspectMarkdownFile()` which builds a `BaseFileInspection` from Obsidian's `MetadataCache` (frontmatter properties, tags, links, backlinks, embeds).
- `guardrails.ts` centralizes path validation (`normalizeVaultToolPath`, `validateToolPath`, `isBlockedVaultPath`), glob matching (`matchGlob`, `matchVaultPattern`), and file-kind helpers (`kindForFile`, `isTextReadable`, `filterVisibleFiles`).
- Base context detection (`baseRequiresContext`) checks formulas, filters, and summaries for `this` references using both string scanning and AST-based inspection.
- Truncation defaults: 2000 lines / 50KB (matching Pi agent defaults).
- Vault tool headers should use short display names via `pathDisplayName()`. Keep full paths in expanded tool details and Markdown exports.

## Documentation

Update `README.md` when changing user-visible behavior, setup commands, auth behavior, supported providers, build output, or deployment steps. Update `docs/shims.md` when changing shims or Vite aliases for Pi dependencies.
