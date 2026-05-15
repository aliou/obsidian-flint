import { getProviders } from "@earendil-works/pi-ai";
import { Notice, Setting } from "obsidian";
import type { CustomProviderConfig } from "@/settings/types";
import { CustomProviderModal } from "@/settings/views/provider-modal";
import type { SettingsTabContext } from "./types";

export type ProvidersTabState = {
  builtinSearch: string;
  expandedBuiltinProvider: string | null;
  customProviderFilter: string;
};

export function renderProvidersTab(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
  state: ProvidersTabState,
): void {
  ctx.renderPageHeader(
    containerEl,
    "Configure built-in providers and custom OpenAI-compatible providers.",
  );

  renderBuiltinProviders(ctx, containerEl, state);
  renderCustomProviders(ctx, containerEl, state);
}

function renderBuiltinProviders(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
  state: ProvidersTabState,
): void {
  containerEl.createEl("h3", { text: "Built-in providers" });

  new Setting(containerEl)
    .setDesc(
      "Search for a built-in provider and configure its API key. Providers with a linked secret appear under Configured.",
    )
    .addSearch((search) => {
      search.setPlaceholder("Search built-in providers...");
      search.setValue(state.builtinSearch);
      search.onChange((value) => {
        state.builtinSearch = value;
        ctx.display();
      });
    });

  const allBuiltin = getBuiltinProviders(ctx);
  const configured: string[] = [];
  const notConfigured: string[] = [];

  for (const provider of allBuiltin) {
    if (ctx.plugin.secrets.hasCredential(provider)) configured.push(provider);
    else notConfigured.push(provider);
  }

  if (configured.length > 0)
    renderProviderSection(
      ctx,
      containerEl,
      state,
      "Configured",
      configured,
      true,
    );

  const filter = state.builtinSearch.trim().toLowerCase();
  if (filter) {
    const matches = notConfigured.filter((p) =>
      p.toLowerCase().includes(filter),
    );
    if (matches.length > 0) {
      renderProviderSection(
        ctx,
        containerEl,
        state,
        `Results for "${state.builtinSearch.trim()}"`,
        matches,
        true,
      );
    } else {
      containerEl.createDiv({
        cls: "flint-empty-state",
        text: `No built-in providers matching "${state.builtinSearch.trim()}".`,
      });
    }
  } else if (notConfigured.length > 0) {
    containerEl.createDiv({
      cls: "flint-empty-state",
      text: "Search for a provider to configure its API key.",
    });
  }
}

function renderProviderSection(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
  state: ProvidersTabState,
  title: string,
  providers: string[],
  expandable: boolean,
): void {
  const section = containerEl.createDiv("flint-provider-section");
  section.createDiv({ cls: "flint-provider-section-title", text: title });
  const list = section.createDiv("flint-provider-list");
  for (const provider of providers)
    renderBuiltinProviderCard(ctx, list, state, provider, expandable);
}

function renderBuiltinProviderCard(
  ctx: SettingsTabContext,
  parent: HTMLElement,
  state: ProvidersTabState,
  provider: string,
  expandable: boolean,
): void {
  const card = parent.createDiv("flint-provider-card");
  const header = card.createDiv("flint-provider-card-header");
  const isActive = provider === ctx.plugin.store.settings.provider;
  const title = isActive ? `${provider} (active)` : provider;
  header.createDiv({ cls: "flint-provider-card-title", text: title });
  header.createDiv({
    cls: "flint-provider-card-meta",
    text: credentialStatusText(ctx, provider),
  });

  if (expandable) {
    const actions = header.createDiv("flint-provider-card-actions");
    const isExpanded = state.expandedBuiltinProvider === provider;
    actions
      .createEl("button", { text: isExpanded ? "Collapse" : "Configure" })
      .addEventListener("click", () => {
        state.expandedBuiltinProvider = isExpanded ? null : provider;
        ctx.display();
      });
  }

  if (state.expandedBuiltinProvider === provider)
    renderBuiltinProviderConfig(ctx, card, provider);
}

function renderBuiltinProviderConfig(
  ctx: SettingsTabContext,
  parent: HTMLElement,
  provider: string,
): void {
  const config = parent.createDiv("flint-builtin-config");
  const currentSecretId =
    ctx.plugin.store.settings.providerAuth[provider]?.secretId ?? "";
  const requiresApiKey = ctx.plugin.secrets.providerRequiresApiKey(provider);

  new Setting(config)
    .setName("Requires API key")
    .setDesc(
      "Disable when the provider endpoint ignores Authorization or does not need credentials.",
    )
    .addToggle((toggle) =>
      toggle.setValue(requiresApiKey).onChange(async (value) => {
        await ctx.plugin.secrets.setProviderAuth(provider, {
          requiresApiKey: value,
          secretId: value ? currentSecretId || undefined : undefined,
        });
        ctx.display();
      }),
    );

  if (!requiresApiKey) {
    new Setting(config)
      .setName("Secret")
      .setDesc("No API key required. This provider is considered configured.");
    return;
  }

  new Setting(config)
    .setName("Secret")
    .setDesc(
      "Select a secret from Obsidian SecretStorage to use as the API key.",
    )
    .addDropdown((dropdown) => {
      dropdown.addOption("", "No secret linked");
      for (const secretId of ctx.plugin.secrets.listSecretIds())
        dropdown.addOption(secretId, secretId);
      dropdown.setValue(currentSecretId);
      dropdown.onChange(async (value) => {
        await ctx.plugin.secrets.setProviderAuth(provider, {
          requiresApiKey,
          secretId: value || undefined,
        });
        ctx.display();
      });
    })
    .addButton((button) =>
      button.setButtonText("+ Add secret").onClick(() => {
        ctx.plugin.secrets.openAddSecretModal(async (newSecretId) => {
          await ctx.plugin.secrets.setProviderAuth(provider, {
            requiresApiKey,
            secretId: newSecretId,
          });
          ctx.display();
        });
      }),
    );

  if (currentSecretId) {
    new Setting(config)
      .setName("Remove key")
      .setDesc("Unlink the secret from this provider.")
      .addButton((button) =>
        button.setButtonText("Unlink").onClick(async () => {
          await ctx.plugin.secrets.setProviderAuth(provider, {
            requiresApiKey,
            secretId: undefined,
          });
          ctx.display();
        }),
      );
  }
}

function renderCustomProviders(
  ctx: SettingsTabContext,
  containerEl: HTMLElement,
  state: ProvidersTabState,
): void {
  containerEl.createEl("h3", { text: "Custom providers" });

  new Setting(containerEl)
    .setName("Add provider")
    .setDesc(
      "Add an OpenAI-compatible provider manually or discover its model ids from the /models endpoint.",
    )
    .addButton((button) =>
      button
        .setButtonText("Add provider")
        .setCta()
        .onClick(() => {
          new CustomProviderModal(ctx.app, ctx.plugin, undefined, () =>
            ctx.display(),
          ).open();
        }),
    );

  if (ctx.plugin.store.settings.customProviders.length === 0) {
    containerEl.createDiv({
      cls: "flint-empty-state",
      text: "No custom providers yet.",
    });
    return;
  }

  new Setting(containerEl).setName("Filter").addSearch((search) => {
    search.setPlaceholder("Filter custom providers");
    search.setValue(state.customProviderFilter);
    search.onChange((value) => {
      state.customProviderFilter = value;
      ctx.display();
    });
  });

  const list = containerEl.createDiv("flint-provider-list");
  const filter = state.customProviderFilter.trim().toLowerCase();
  const providers = ctx.plugin.store.settings.customProviders.filter(
    (provider) => {
      if (!filter) return true;
      return (
        provider.id.toLowerCase().includes(filter) ||
        provider.name?.toLowerCase().includes(filter) ||
        provider.baseUrl.toLowerCase().includes(filter)
      );
    },
  );

  if (providers.length === 0) {
    list.createDiv({
      cls: "flint-empty-state",
      text: "No providers match this filter.",
    });
    return;
  }

  for (const provider of providers)
    renderCustomProviderCard(ctx, list, provider);
}

function renderCustomProviderCard(
  ctx: SettingsTabContext,
  parent: HTMLElement,
  provider: CustomProviderConfig,
): void {
  const card = parent.createDiv("flint-provider-card");
  const header = card.createDiv("flint-provider-card-header");
  header.createDiv({
    cls: "flint-provider-card-title",
    text: provider.name ? `${provider.name} (${provider.id})` : provider.id,
  });
  header.createDiv({
    cls: "flint-provider-card-subtitle",
    text: provider.baseUrl,
  });
  const modelLabel =
    provider.models.length === 1
      ? "1 model"
      : `${provider.models.length} models`;
  header.createDiv({
    cls: "flint-provider-card-meta",
    text: `${modelLabel} - ${credentialStatusText(ctx, provider.id)}`,
  });

  const actions = card.createDiv("flint-provider-card-actions");
  actions
    .createEl("button", { text: "Select" })
    .addEventListener("click", async () => {
      try {
        await ctx.plugin.modelRegistry.setProvider(provider.id);
        new Notice(`Selected ${provider.id}`);
        ctx.display();
      } catch (error) {
        ctx.notice(error);
      }
    });
  actions
    .createEl("button", { text: "Edit" })
    .addEventListener("click", () =>
      new CustomProviderModal(ctx.app, ctx.plugin, provider, () =>
        ctx.display(),
      ).open(),
    );
  actions
    .createEl("button", { text: "Remove" })
    .addEventListener("click", async () => {
      try {
        await ctx.plugin.modelRegistry.removeCustomProvider(provider.id);
        ctx.display();
      } catch (error) {
        ctx.notice(error);
      }
    });
}

function getBuiltinProviders(ctx: SettingsTabContext): string[] {
  const customIds = new Set(
    ctx.plugin.store.settings.customProviders.map((p) => p.id),
  );
  return getProviders()
    .filter((p) => !customIds.has(p))
    .sort((a, b) => a.localeCompare(b));
}

function credentialStatusText(
  ctx: SettingsTabContext,
  provider: string,
): string {
  if (!ctx.plugin.secrets.providerRequiresApiKey(provider))
    return "No API key required";
  const secretId = ctx.plugin.secrets.getProviderSecretId(provider);
  if (!secretId) return "No secret linked";
  const secret = ctx.app.secretStorage.getSecret(secretId);
  if (!secret?.trim()) return `Linked to ${secretId} (empty)`;
  return `Linked to ${secretId}`;
}
