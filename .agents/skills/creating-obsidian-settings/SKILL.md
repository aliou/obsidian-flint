---
name: creating-obsidian-settings
description: "Explains how to create, refactor, and review Obsidian 1.13+ plugin settings pages with SettingDefinitionItem, pages, groups, lists, controls, custom renderers, and custom settings storage. Use when working on Obsidian plugin settings UI or settings tab code."
---

# Creating Obsidian Settings

Use Obsidian 1.13+ settings definitions first. Avoid old imperative `new Setting(containerEl)` page renderers unless the UI is genuinely custom.

## Default structure

Extend `PluginSettingTab` and implement `getSettingDefinitions()`:

```ts
class MySettingsTab extends PluginSettingTab {
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "page",
        name: "Context",
        desc: "System prompt and instructions.",
        items: [
          {
            type: "group",
            heading: "System prompt",
            items: [
              {
                name: "Custom system prompt",
                desc: "Optional text appended to the base prompt.",
                control: {
                  type: "textarea",
                  key: "systemPrompt",
                  defaultValue: "",
                },
              },
            ],
          },
        ],
      },
    ];
  }
}
```

Use:
- `type: "page"` for navigation pages.
- `type: "group"` for headings/sections.
- `type: "list"` for dynamic repeated rows.
- `control` for standard inputs: `toggle`, `text`, `textarea`, `dropdown`, `slider`, `file`, `folder`, `number`, `color`.
- `render` only for custom layout, async preview, secret controls, dynamic dropdowns with side effects, or controls that need extra Obsidian `Setting` APIs.

## Settings storage

If settings live somewhere other than Obsidian's default settings object, override both value methods and bridge by key:

```ts
getControlValue(key: string): unknown {
  const settings = this.plugin.settingsStore.settings;
  switch (key) {
    case "systemPrompt":
      return settings.systemPrompt;
    default:
      return super.getControlValue(key);
  }
}

async setControlValue(key: string, value: unknown): Promise<void> {
  switch (key) {
    case "systemPrompt":
      await this.plugin.settingsStore.update({ systemPrompt: String(value) });
      return;
    default:
      await super.setControlValue(key, value);
  }
}
```

Use dotted keys for nested settings (`export.outputDirectory`) and prefix keys for dynamic sets (`tool:read`). Keep parsing, validation, normalization, and side effects in `setControlValue()`.

## Page and group nesting

Nested pages must be inside their parent group's or page's `items` array. Do not append child pages as siblings after the group that describes them.

```ts
{
  type: "group",
  heading: "Configured providers",
  items: [
    ...configuredBuiltinProviderPages(),
    ...customProviderPages(),
  ],
}
```

## Textarea layout trick

Declarative `control: { type: "textarea" }` renders the textarea beside the setting name/description. For long textareas, use `render` and add a stacked class so the textarea appears below the label.

```ts
{
  name: "Prompt suggestions",
  desc: "Prompt chips shown before a conversation starts. Use one per line.",
  render: (setting) => {
    setting.setClass("my-plugin-stacked-setting").addTextArea((text) => {
      text.inputEl.rows = 4;
      text.setValue(plugin.settings.promptSuggestions.join("\n"));
      text.onChange(async (value) => {
        plugin.settings.promptSuggestions = value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        await plugin.saveSettings();
      });
    });
  },
}
```

CSS:

```css
.my-plugin-stacked-setting {
  flex-direction: column;
  align-items: stretch;
}

.my-plugin-stacked-setting .setting-item-info {
  width: 100%;
  margin-bottom: 8px;
}

.my-plugin-stacked-setting .setting-item-control {
  width: 100%;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 8px;
}

.my-plugin-stacked-setting textarea {
  width: 100%;
}
```

## Practical guidelines

- Prefer built-in `file` and `folder` controls before writing custom suggesters.
- Keep secret/API-key fields and model/provider discovery as custom `render` controls.
- Use `render` for async previews because declarative controls only handle the input itself.
- After settings changes, run any plugin-specific refresh/reload hooks needed for active views or services.
- Keep page definition files data-oriented; avoid mixing old full-page imperative rendering with new declarative definitions.

## Validation

Before handoff, run the project's normal checks, usually:

```bash
pnpm check
pnpm lint
pnpm build
```
