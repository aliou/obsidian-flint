# Flint

**Flint is an Obsidian plugin to have an agent inside of your vaults. It can see and do everything you can do in your vault.**

Flint lives in your sidebar. Ask it to find notes, write drafts, reorganize folders, search across your vault, query Bases — anything you'd do yourself, but faster. It reads your files, understands your structure, and acts on your instructions directly inside Obsidian.

## What Flint can do

### Work with your vault

Flint has direct access to your vault's files and folders. It can:

- **List and browse** folders and their contents
- **Read** notes, text files, and Bases (with support for large files)
- **Write** new notes or update existing ones (creating parent folders as needed)
- **Delete** files (moves to trash, respecting your Obsidian settings)
- **Create folders** anywhere in your vault
- **Find files** by name, path, or glob pattern — filtered by type
- **Search** file contents with regex or plain text, with context around matches

### Query Obsidian Bases

Flint understands Bases natively — list them, inspect their views and columns, and run queries directly.

All vault operations automatically skip hidden system paths (`.obsidian`, etc.).

## Chat

Open Flint from the sidebar. Type a message and it responds — with full access to your vault when it needs it.

**Wikilink autocomplete** — Type `[[` to reference vault files directly in your message. The autocomplete shows filenames and their parent folder for easy identification.

**Commands** — Type `/` to see available commands:
- `/compact` — Summarize and compress a long conversation to keep things fast
- `/skill:<name>` — Run a configured skill with optional extra instructions

**Prompt chips** — An empty chat shows configurable quick-start prompts to get you going.

**Clickable vault paths** — When Flint mentions a file like `/Notes/file.md`, click it to open the file directly in Obsidian.

**Sessions** — Conversations are saved automatically. Browse, resume, or delete past sessions from the session history panel.

**Model picker** — Switch models, set favorites, and adjust thinking level from the chat header.

**Works on mobile** — Flint adapts its layout for smaller screens with a compact status bar.

## Skills and customization

- **System prompt** — Customize the base instructions Flint follows.
- **AGENTS.md** — Add project-level instructions that Flint picks up automatically.
- **Skills** — Point Flint at skill folders and it watches for changes, reloading automatically.
- **Tool toggles** — Enable or disable individual vault tools from settings.
- **Compaction** — Configure automatic conversation compaction, or trigger it manually with `/compact`.

## Providers

Flint works with built-in Pi providers and any OpenAI-compatible API. Add a custom provider by pointing to a base URL — Flint discovers available models automatically.

API keys are stored securely using Obsidian's secret storage.

## Export conversations

Export any conversation as a Markdown file with frontmatter. Choose whether to include reasoning blocks and tool calls. Exports are saved to a configurable folder (default: `Flint Exports`) and open in a new tab.

Export from the chat header button, the command palette, or the editor context menu.

## Under the hood

Flint is built on top of [Pi's AgentHarness](https://github.com/earendil-works/pi) abstraction, adapted to run inside Obsidian with vault-scoped file access and Obsidian-native secret storage.

## Build from source

```bash
npm install
npm run build
```

Output goes to `dist/` — copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder, then enable Flint in Obsidian settings.

Optional checks before building:

```bash
npm run check   # type-check
npm run lint    # lint
```
