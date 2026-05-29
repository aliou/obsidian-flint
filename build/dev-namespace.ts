import type { Plugin } from "vite";

/**
 * In dev builds the plugin ships under a separate id ("flint-dev") so it can be
 * enabled alongside the production build. Anything that lands in a global
 * namespace (the workspace view type, CSS class names, the registered icon)
 * would otherwise collide with the production build and crash on load.
 *
 * This plugin rewrites our `flint-` tokens to `flint-dev-` in both the JS and
 * CSS output, keeping the two in sync. The match is deliberately narrow:
 *
 * - Only `flint-` at a token boundary is rewritten. `flint-` preceded by a word
 *   character or hyphen (e.g. the command ids `export-flint-conversation`,
 *   `reload-flint-harness`) is left alone, as are package names.
 * - Export tokens are shared with the production build so exported notes render
 *   with the same callout/class styles regardless of which build created them.
 *   `flint-export-*`, `flint-tool*` (callouts `flint-tools`, `flint-tool-*`) and
 *   `flint-reasoning` are therefore excluded.
 */
const FLINT_TOKEN = /(?<![\w-])flint-(?!dev-|export|tool|reasoning)/g;

const DEV_PREFIX = "flint-dev-";

export function devNamespace(isDev: boolean): Plugin {
  return {
    name: "flint-dev-namespace",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      if (!isDev) return;
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk" && file.fileName.endsWith(".js")) {
          file.code = file.code.replace(FLINT_TOKEN, DEV_PREFIX);
        } else if (
          file.type === "asset" &&
          file.fileName.endsWith(".css") &&
          typeof file.source === "string"
        ) {
          file.source = file.source.replace(FLINT_TOKEN, DEV_PREFIX);
        }
      }
    },
  };
}
