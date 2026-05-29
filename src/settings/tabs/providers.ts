import { getProviders } from "@earendil-works/pi-ai";
import {
  AbstractInputSuggest,
  type App,
  Notice,
  SecretComponent,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";
import type FlintPlugin from "@/main";
import type { CustomProviderConfig } from "@/settings/types";
import { CustomProviderModal } from "@/settings/views/provider-modal";

type ProviderPickerState = {
  selectedBuiltinProvider: string;
  selectedEl?: HTMLElement;
};

export function providerSettingDefinitions(
  app: App,
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  return [
    {
      type: "group",
      heading: "Built-in providers",
      items: [
        {
          name: "Add or configure provider",
          desc: "Search a built-in provider, then link its API key and optional provider-specific proxy.",
          render: (setting) => {
            const state: ProviderPickerState = { selectedBuiltinProvider: "" };
            const providers = getBuiltinProviders(plugin);
            setting.addText((text) => {
              text.setPlaceholder("Search built-in providers...");
              text.setValue("");
              new BuiltinProviderSuggest(
                app,
                text.inputEl,
                providers,
                (provider) => {
                  state.selectedBuiltinProvider = provider;
                  text.setValue(provider);
                  renderSelectedBuiltin(app, plugin, state);
                },
              );
              text.inputEl.addEventListener("blur", () => {
                const value = text.getValue().trim();
                if (!providers.includes(value)) text.setValue("");
              });
            });
            state.selectedEl = createDiv({
              cls: "flint-provider-inline-config",
            });
            setting.settingEl.insertAdjacentElement(
              "afterend",
              state.selectedEl,
            );
            renderSelectedBuiltin(app, plugin, state);
          },
        },
      ],
    },
    {
      type: "group",
      heading: "Configured built-in providers",
      visible: () => configuredBuiltinProviderPages(app, plugin).length > 0,
      items: [],
    },
    ...configuredBuiltinProviderPages(app, plugin),
    {
      type: "group",
      heading: "Custom providers",
      items: [
        {
          name: "Add provider",
          desc: "Add an OpenAI-compatible provider manually or discover its models from the /models endpoint.",
          render: (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText("Add provider")
                .setCta()
                .onClick(() => {
                  new CustomProviderModal(app, plugin, undefined, () => {
                    plugin.settingTab?.update();
                  }).open();
                }),
            );
          },
        },
      ],
    },
    ...customProviderPages(app, plugin),
  ];
}

function renderSelectedBuiltin(
  app: App,
  plugin: FlintPlugin,
  state: ProviderPickerState,
): void {
  if (!state.selectedEl) return;
  state.selectedEl.empty();
  const provider = state.selectedBuiltinProvider;
  if (!provider) return;

  new Setting(state.selectedEl).setName(`Configure ${provider}`).setHeading();
  renderBuiltinSecretSetting(app, plugin, state.selectedEl, provider);
  renderBuiltinProxySetting(plugin, state.selectedEl, provider);
}

function configuredBuiltinProviderPages(
  app: App,
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  return getBuiltinProviders(plugin)
    .filter((provider) => hasBuiltinConfig(plugin, provider))
    .map((provider) => ({
      type: "page" as const,
      name: provider,
      desc: builtinProviderDesc(plugin, provider),
      items: [
        {
          type: "group" as const,
          items: [
            {
              name: "API key",
              desc: credentialStatusText(app, plugin, provider),
              render: (setting: Setting) => {
                renderBuiltinSecretControl(app, plugin, setting, provider);
              },
            },
            {
              name: "Proxy base URL",
              desc: "Optional endpoint override for this provider only. Leave empty to use the built-in default.",
              render: (setting: Setting) => {
                renderBuiltinProxyControl(plugin, setting, provider);
              },
            },
          ],
        },
        {
          type: "group" as const,
          items: [
            {
              name: "Remove provider",
              desc: "Clear this provider's linked API key and proxy URL. This removes it from the configured providers list.",
              render: (setting: Setting) => {
                setting.addButton((button) =>
                  button
                    .setButtonText("Remove")
                    .setWarning()
                    .onClick(async () => {
                      await plugin.secrets.setProviderAuth(provider, {
                        requiresApiKey: true,
                        secretId: undefined,
                        proxyBaseUrl: "",
                      });
                      plugin.settingTab?.update();
                      new Notice(`Removed ${provider}`);
                    }),
                );
              },
            },
          ],
        },
      ],
    }));
}

function customProviderPages(
  app: App,
  plugin: FlintPlugin,
): SettingDefinitionItem[] {
  return plugin.store.settings.customProviders.map((provider) => ({
    type: "page" as const,
    name: provider.name ? `${provider.name} (${provider.id})` : provider.id,
    desc: customProviderDesc(app, plugin, provider),
    items: [
      {
        type: "group" as const,
        heading: provider.id,
        items: [
          {
            name: "Provider",
            desc: customProviderDesc(app, plugin, provider),
          },
          {
            name: "Actions",
            render: (setting: Setting) => {
              setting
                .addExtraButton((button) =>
                  button
                    .setIcon("check-circle")
                    .setTooltip("Set as active provider")
                    .onClick(async () => {
                      try {
                        await plugin.modelRegistry.setProvider(provider.id);
                        new Notice(`Selected ${provider.id}`);
                      } catch (error) {
                        new Notice(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }),
                )
                .addExtraButton((button) =>
                  button
                    .setIcon("pencil")
                    .setTooltip("Edit provider")
                    .onClick(() =>
                      new CustomProviderModal(app, plugin, provider, () => {
                        plugin.settingTab?.update();
                      }).open(),
                    ),
                )
                .addExtraButton((button) =>
                  button
                    .setIcon("trash")
                    .setTooltip("Remove provider")
                    .onClick(async () => {
                      try {
                        await plugin.modelRegistry.removeCustomProvider(
                          provider.id,
                        );
                        plugin.settingTab?.update();
                      } catch (error) {
                        new Notice(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      }
                    }),
                );
            },
          },
        ],
      },
    ],
  }));
}

function renderBuiltinSecretSetting(
  app: App,
  plugin: FlintPlugin,
  parent: HTMLElement,
  provider: string,
): void {
  const setting = new Setting(parent)
    .setName("API key")
    .setDesc(credentialStatusText(app, plugin, provider));
  renderBuiltinSecretControl(app, plugin, setting, provider);
}

function renderBuiltinProxySetting(
  plugin: FlintPlugin,
  parent: HTMLElement,
  provider: string,
): void {
  const setting = new Setting(parent)
    .setName("Proxy base URL")
    .setDesc(
      "Optional endpoint override for this provider only. Leave empty to use the built-in default.",
    );
  renderBuiltinProxyControl(plugin, setting, provider);
}

function renderBuiltinSecretControl(
  app: App,
  plugin: FlintPlugin,
  setting: Setting,
  provider: string,
): void {
  new SecretComponent(app, setting.controlEl)
    .setValue(plugin.secrets.getProviderSecretId(provider) ?? "")
    .onChange(async (secretName) => {
      await plugin.secrets.setProviderAuth(provider, {
        requiresApiKey: true,
        secretId: secretName?.trim() || undefined,
      });
      setting.setDesc(credentialStatusText(app, plugin, provider));
      plugin.settingTab?.update();
    });
}

function renderBuiltinProxyControl(
  plugin: FlintPlugin,
  setting: Setting,
  provider: string,
): void {
  setting.addText((text) => {
    text.inputEl.addClass("flint-wide-input");
    text.setPlaceholder("https://proxy.example.com/v1");
    text.setValue(plugin.secrets.getProviderProxyUrl(provider));
    text.onChange(async (value) => {
      await plugin.secrets.setProviderAuth(provider, {
        requiresApiKey: true,
        secretId: plugin.secrets.getProviderSecretId(provider),
        proxyBaseUrl: value,
      });
      if (provider === plugin.store.settings.provider) {
        await plugin.agent.setModel(
          plugin.store.settings.provider,
          plugin.store.settings.modelId,
        );
      }
      plugin.settingTab?.update();
    });
  });
}

function getBuiltinProviders(plugin: FlintPlugin): string[] {
  const customIds = new Set(
    plugin.store.settings.customProviders.map((p) => p.id),
  );
  return getProviders()
    .filter((provider) => !customIds.has(provider))
    .sort((a, b) => a.localeCompare(b));
}

function hasBuiltinConfig(plugin: FlintPlugin, provider: string): boolean {
  const auth = plugin.store.settings.providerAuth[provider];
  return Boolean(auth?.secretId || auth?.proxyBaseUrl);
}

function builtinProviderDesc(plugin: FlintPlugin, provider: string): string {
  const auth = plugin.store.settings.providerAuth[provider];
  const parts = [auth?.secretId ? `Key: ${auth.secretId}` : "No API key"];
  if (auth?.proxyBaseUrl) parts.push(`Proxy: ${auth.proxyBaseUrl}`);
  return parts.join(" · ");
}

function customProviderDesc(
  app: App,
  plugin: FlintPlugin,
  provider: CustomProviderConfig,
): string {
  const modelLabel =
    provider.models.length === 1
      ? "1 model"
      : `${provider.models.length} models`;
  return `${provider.baseUrl} · ${modelLabel} · ${credentialStatusText(app, plugin, provider.id)}`;
}

function credentialStatusText(
  app: App,
  plugin: FlintPlugin,
  provider: string,
): string {
  if (!plugin.secrets.providerRequiresApiKey(provider))
    return "No API key required";
  const secretId = plugin.secrets.getProviderSecretId(provider);
  if (!secretId) return "No API key set";
  const secret = app.secretStorage.getSecret(secretId);
  if (!secret?.trim()) return `Linked to ${secretId} (empty)`;
  return `Linked to ${secretId}`;
}

class BuiltinProviderSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly providers: string[],
    private readonly onChoose: (provider: string) => void,
  ) {
    super(app, inputEl);
    this.limit = 100;
    this.onSelect((provider) => this.onChoose(provider));
  }

  protected getSuggestions(query: string): string[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return this.providers;
    return this.providers.filter((provider) =>
      provider.toLowerCase().includes(normalized),
    );
  }

  renderSuggestion(provider: string, el: HTMLElement): void {
    el.setText(provider);
  }
}
