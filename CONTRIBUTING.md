# Contributing to Flint

## Requirements

- Node.js 22 (provided via the Nix flake, or install separately)
- pnpm
- Obsidian desktop for testing
- A disposable test vault

## Setup

```bash
git clone https://github.com/aliou/obsidian-flint.git
cd obsidian-flint
pnpm install
```

If you use Nix:

```bash
nix develop
pnpm install
```

## Build

```bash
pnpm build          # production build
pnpm build:dev      # development build
```

Output goes to `dist/`. Copy `main.js`, `manifest.json`, and `styles.css` into your test vault's `.obsidian/plugins/flint/` directory, then enable the plugin in Obsidian.

## Checks

Run these before submitting changes:

```bash
pnpm check          # TypeScript type-check
pnpm lint           # Biome lint and format check
pnpm build          # production build
```

Other commands:

```bash
pnpm format         # auto-fix lint and formatting
pnpm test           # vitest run
pnpm test:watch     # vitest watch
```

## Project structure

Key source directories:

- `src/main.ts` — plugin lifecycle, view registration, commands, skill watchers
- `src/chat/` — controller, harness, view, slash commands, session stats, tool renderers
- `src/harness/` — execution env, model registry, secrets, session storage, tools, skills
- `src/settings/` — store, tab, pages (model, context, tools, exports, advanced, providers), modals
- `src/export/` — Markdown export builder and service
- `src/shims/` — browser-safe shims for Pi Node dependencies (see `docs/shims.md`)

See `AGENTS.md` for detailed file descriptions and coding guidelines.

## Coding guidelines

- TypeScript strict mode. Avoid `any`; prefer explicit local types.
- Obsidian UI code stays imperative. Use Obsidian DOM helpers where existing code does.
- Normalize all vault paths with `normalizePath`.
- Treat paths shown to the agent as absolute-looking vault paths (e.g. `/Notes/file.md`).
- No shell execution. `ObsidianExecutionEnv.exec` remains unavailable.
- Do not expose `.obsidian` or `.pi` through tools.
- Do not import Node built-ins at module top level in Obsidian code. Use shims or guarded runtime loading.
- Keep mobile/browser safety in mind. Desktop Obsidian is the primary target.
- Use `@/` imports for local source files.
- Follow Biome formatting and lint rules.

## Testing UI changes

When changing UI, check:

- Sidebar layout at narrow widths
- Chat scrolling and loading states
- Empty, error, and disabled states
- Light and dark theme compatibility
- Mobile layout and keyboard handling

Test file operations and exports against a disposable vault.

## Pull requests

- Clear description of the change
- Screenshots or GIFs for UI changes
- Notes about tested Obsidian versions
- All checks passing (`pnpm check && pnpm lint && pnpm build`)

## Documentation

- Update `README.md` for user-visible changes (behavior, setup, auth, providers, build steps)
- Update `docs/shims.md` when changing shims or Vite aliases
- Update `AGENTS.md` when changing key files or architecture
