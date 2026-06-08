# obsidian-flint

## 0.2.0

### Minor Changes

- 23767f0: Add auto-name sessions and `/name` command

  - Auto-name service runs an Agent with a `set_name` tool after the first successful turn to generate a session name
  - `/name` slash command to manually rename the current session
  - "Auto-name sessions" settings page under "Tools & Hooks" with enable/disable toggle, custom prompt, and provider/model selection
  - Session title shown in chat header and tab title, updated live

- 61730e7: Modernize Flint settings to use Obsidian's declarative settings definitions and navigable page groups.

### Patch Changes

- 409d01b: Use Obsidian linktext when inserting wikilink suggestions so duplicate note names stay path-qualified.

## 0.1.1

### Patch Changes

- 1a595d8: Fix reader mode crashes caused by app-relative fetch URLs.
