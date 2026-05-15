# Shims

This plugin runs Pi packages inside Obsidian. The files in `src/shims` provide the browser-safe Obsidian implementations required by dependencies that use Node APIs, environment variables, proxy helpers, or a standard `fetch` transport.

## `src/shims/fetch.ts`

Installs an Obsidian-compatible `globalThis.fetch` implementation used by model SDKs.

Why it exists:

- Browser `fetch` inside Obsidian can hit CORS and streaming limitations.
- Desktop Obsidian can use Node `http`/`https`, but those built-ins must not be imported at module top level because mobile loads the same bundle.
- Authless custom providers still require a placeholder API key for the model SDK, but the outgoing `Authorization` header must be stripped for those provider base URLs.

Behavior:

- Saves the original `fetch` and patches `globalThis.fetch` once.
- Uses Node `http`/`https` on desktop, loaded lazily through `globalThis.require`.
- Uses Obsidian `requestUrl` as the non-desktop fallback.
- Uses the original browser `fetch` for request body types outside the supported Obsidian transport set.
- Removes `Authorization` for configured authless custom provider base URLs.
- The set of authless base URLs is refreshed dynamically via `installObsidianNodeFetch` when provider settings change (not just at initial install).

Placeholder API key:

- The constant `OBSIDIAN_AUTHLESS_API_KEY` (value `"obsidian-authless-provider"`) is used as the API key for providers that do not require authentication. The fetch shim strips the `Authorization` header before sending requests to those provider base URLs.

Transport notes:

- The `requestUrl` transport buffers responses and does not provide true streaming.
- Request body support is intentionally focused on the JSON request bodies used by model SDK calls.

## `src/shims/pi-ai-env.ts`

Stubs Pi AI environment-variable API key lookup.

Why it exists:

- Obsidian plugins should not read API keys from process environment variables.
- Credentials are managed by Obsidian `SecretStorage` through `src/harness/secrets`.

Behavior:

- Always returns no environment keys.

## `src/shims/pi-ai-node-http-proxy.ts`

Stubs Pi AI Node HTTP proxy agent creation.

Why it exists:

- Pi AI proxy support depends on Node-only proxy packages and Node built-ins that are unsafe for Obsidian's browser/mobile environment.
- Obsidian provider requests run without proxy agents.

Behavior:

- Returns empty proxy agent options.

## Vite aliases

`vite.config.ts` aliases Pi dependency imports to these shims:

- `env-api-keys` -> `src/shims/pi-ai-env.ts`
- `node-http-proxy` -> `src/shims/pi-ai-node-http-proxy.ts`

The fetch shim is not aliased. It is installed explicitly from plugin startup through `installObsidianNodeFetch()`.
