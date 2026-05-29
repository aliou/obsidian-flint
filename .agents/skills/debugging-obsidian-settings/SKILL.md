---
name: debugging-obsidian-settings
description: "Debugs and inspects Obsidian Settings windows, especially plugin settings icons/UI, using the Obsidian CLI plus Chrome DevTools Protocol targets. Use when needing DOM, CSS, screenshots, or webContents inspection for Settings."
---

# Debugging Obsidian Settings

Use this when inspecting Obsidian Settings UI. The Settings window is a separate CDP target/webContents, so normal `Obsidian dev:dom` may inspect the main window instead.

## Workflow

1. Build and install the plugin into the test vault if needed.
2. Relaunch Obsidian with a remote debugging port.
3. Open Settings with the Obsidian CLI.
4. Find the CDP target whose title starts with `Settings -`.
5. Evaluate DOM/CSS scripts or capture screenshots against that target.

## Commands

Launch Obsidian with CDP on port `9333`:

```bash
osascript -e 'quit app "Obsidian"' 2>/dev/null || true
sleep 3
/Applications/Obsidian.app/Contents/MacOS/Obsidian --remote-debugging-port=9333
```

Use the `process` tool for the launch command because it is long-running.

Open Settings in the test vault:

```bash
Obsidian vault=ztesting command id=app:open-settings
```

List CDP targets:

```bash
curl -s -m4 http://127.0.0.1:9333/json | python3 -c "import sys,json; d=json.load(sys.stdin); [print(i,'|',t['type'],'|',repr(t.get('title','')[:60]),'|',t.get('webSocketDebuggerUrl','')[-32:]) for i,t in enumerate(d)]"
```

Get the Settings WebSocket URL:

```bash
curl -s -m4 http://127.0.0.1:9333/json | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(t['webSocketDebuggerUrl'] for t in d if t.get('title','').startswith('Settings -')))"
```

## CDP evaluator

Create a temporary evaluator when needed:

```js
// /tmp/cdp-obsidian-settings.mjs
import WebSocket from "./node_modules/ws/wrapper.mjs";
const [, , wsUrl, expr] = process.argv;
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
ws.on("open", async () => {
  await send("Runtime.enable");
  const result = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails) console.error(JSON.stringify(result.result.exceptionDetails, null, 2));
  console.log(JSON.stringify(result.result?.result?.value ?? result, null, 2));
  ws.close();
});
```

Run it from the project root so `./node_modules/ws/wrapper.mjs` resolves:

```bash
WS=$(curl -s -m4 http://127.0.0.1:9333/json | python3 -c "import sys,json; d=json.load(sys.stdin); print(next(t['webSocketDebuggerUrl'] for t in d if t.get('title','').startswith('Settings -')))")
node /tmp/cdp-obsidian-settings.mjs "$WS" 'Array.from(document.querySelectorAll(".vertical-tab-nav-item")).map((el,i)=>({i,text:el.innerText,html:el.outerHTML.slice(0,500)}))'
```

## Useful snippets

Inspect settings sidebar icons:

```js
Array.from(document.querySelectorAll(".vertical-tab-nav-item")).map((el, i) => ({
  i,
  text: el.innerText.trim(),
  svg: el.querySelector("svg")?.outerHTML,
}))
```

Scroll a plugin settings item into view:

```js
(() => {
  const el = [...document.querySelectorAll(".vertical-tab-nav-item")]
    .find((e) => e.innerText.trim() === "Flint (dev)");
  el?.scrollIntoView({ block: "center" });
  return Boolean(el);
})()
```

Capture the Settings target screenshot via CDP, not `Obsidian dev:screenshot`, if the CLI points at the main window.

## Notes

- Custom Obsidian icons are wrapped in an outer SVG such as `viewBox="0 0 100 100"`. Avoid returning a nested full `<svg>` from `addIcon`; prefer paths/groups scaled to the wrapper viewBox.
- Built-in settings icons are usually Lucide-style, `24x24`, `stroke-width="2"`, round caps and joins.
- If `9222` is occupied, use `9333`.
