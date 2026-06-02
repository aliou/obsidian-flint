import { Platform, requestUrl } from "obsidian";

export const OBSIDIAN_AUTHLESS_API_KEY = "obsidian-authless-provider";

type FetchPatchState = {
  originalFetch?: typeof fetch;
  installed: boolean;
  authlessBaseUrls: Set<string>;
};

type RequestBody = string | ArrayBuffer | Uint8Array;

type NodeHttpModule = {
  request: (
    options: {
      protocol: string;
      hostname: string;
      port?: string;
      path: string;
      method: string;
      headers: Record<string, string>;
    },
    callback: (res: NodeIncomingMessage) => void,
  ) => NodeClientRequest;
};

type NodeIncomingMessage = {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | number | undefined>;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  destroy: () => void;
};

type NodeClientRequest = {
  write: (chunk: string | Uint8Array) => void;
  end: () => void;
  destroy: (error?: Error) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
};

const STATE_KEY = Symbol.for("flint.obsidian-fetch");

function getState(): FetchPatchState {
  const globalRecord = globalThis as typeof globalThis & {
    [STATE_KEY]?: FetchPatchState;
  };
  if (!globalRecord[STATE_KEY]) {
    globalRecord[STATE_KEY] = {
      originalFetch: globalThis.fetch?.bind(globalThis),
      installed: false,
      authlessBaseUrls: new Set(),
    };
  }
  return globalRecord[STATE_KEY];
}

export function installObsidianNodeFetch(options?: {
  authlessBaseUrls?: string[];
}): void {
  const state = getState();
  state.authlessBaseUrls = new Set(
    (options?.authlessBaseUrls ?? []).map(normalizeBaseUrl).filter(Boolean),
  );
  if (state.installed) return;

  state.originalFetch =
    state.originalFetch ?? globalThis.fetch?.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    obsidianFetch(input, init, state)) as typeof fetch;
  state.installed = true;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function shouldStripAuthorization(
  url: string,
  state: FetchPatchState,
): boolean {
  const normalizedUrl = normalizeBaseUrl(url);
  for (const baseUrl of state.authlessBaseUrls) {
    if (normalizedUrl === baseUrl || normalizedUrl.startsWith(`${baseUrl}/`))
      return true;
  }
  return false;
}

function requestUrlString(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== "undefined" && input instanceof Request)
    return input.method;
  return "GET";
}

function requestHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  stripAuthorization: boolean,
): Headers {
  const headers = new Headers(
    typeof Request !== "undefined" && input instanceof Request
      ? input.headers
      : undefined,
  );
  if (init?.headers) {
    for (const [key, value] of new Headers(init.headers)) {
      headers.set(key, value);
    }
  }
  if (stripAuthorization) headers.delete("authorization");
  return headers;
}

async function requestBody(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<RequestBody | undefined> {
  const body = init?.body;
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== "undefined" && body instanceof Blob)
    return body.arrayBuffer();

  // The OpenAI SDK sends JSON strings for our use case. If another dependency sends
  // FormData or a streaming body, fall back to the original browser fetch path.
  throw new Error(
    `Unsupported fetch body type: ${Object.prototype.toString.call(body)}`,
  );
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers) {
    result[key] = value;
  }
  return result;
}

function headersFromObject(
  headers: Record<string, string | string[] | number | undefined>,
): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value != null) {
      result.set(key, String(value));
    }
  }
  return result;
}

function abortError(): Error {
  if (typeof DOMException !== "undefined")
    return new DOMException("The operation was aborted.", "AbortError");
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function bodyByteLength(body: RequestBody): number {
  if (typeof body === "string")
    return new TextEncoder().encode(body).byteLength;
  return body.byteLength;
}

function bodyToNodeChunk(body: RequestBody): string | Uint8Array {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function uint8ToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function obsidianFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  state: FetchPatchState,
): Promise<Response> {
  const url = requestUrlString(input);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    // Obsidian core can call fetch with app-relative URLs. Keep those on the
    // native fetch path instead of forcing URL parsing for Flint API calls.
    if (!state.originalFetch) throw error;
    return state.originalFetch(input, init);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    if (!state.originalFetch)
      throw new Error(`Unsupported fetch protocol: ${parsed.protocol}`);
    return state.originalFetch(input, init);
  }

  let body: RequestBody | undefined;
  try {
    body = await requestBody(input, init);
  } catch (error) {
    if (!state.originalFetch) throw error;
    return state.originalFetch(input, init);
  }

  const method = requestMethod(input, init).toUpperCase();
  const headers = requestHeaders(
    input,
    init,
    shouldStripAuthorization(url, state),
  );

  if (Platform.isDesktopApp) {
    return nodeFetch(parsed, method, headers, body, init);
  }
  return requestUrlFetch(url, method, headers, body);
}

async function requestUrlFetch(
  url: string,
  method: string,
  headers: Headers,
  body: RequestBody | undefined,
): Promise<Response> {
  // requestUrl is the mobile-safe CORS-bypassing path, but it buffers the full
  // response and does not expose true streaming or AbortSignal cancellation.
  headers.delete("content-length");
  const response = await requestUrl({
    url,
    method,
    headers: headersToObject(headers),
    body:
      typeof body === "string"
        ? body
        : body instanceof Uint8Array
          ? uint8ToArrayBuffer(body)
          : body,
    throw: false,
  });

  return new Response(response.text, {
    status: response.status,
    statusText: String(response.status),
    headers: response.headers,
  });
}

function loadNodeHttpModules(): {
  http: NodeHttpModule;
  https: NodeHttpModule;
} {
  // Keep Node builtins out of top-level imports so the mobile WebView can load
  // this plugin. This branch is only used in desktop Obsidian.
  const nodeRequire = (globalThis as { require?: (id: string) => unknown })
    .require;
  if (!nodeRequire) throw new Error("Node require is unavailable");
  return {
    http: nodeRequire("node:http") as NodeHttpModule,
    https: nodeRequire("node:https") as NodeHttpModule,
  };
}

async function nodeFetch(
  parsed: URL,
  method: string,
  headers: Headers,
  body: RequestBody | undefined,
  init: RequestInit | undefined,
): Promise<Response> {
  if (body != null && !headers.has("content-length"))
    headers.set("content-length", String(bodyByteLength(body)));

  return new Promise<Response>((resolve, reject) => {
    if (init?.signal?.aborted) {
      reject(abortError());
      return;
    }

    const { http, https } = loadNodeHttpModules();
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: headersToObject(headers),
      },
      (res) => {
        const bodyStream = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on("data", (chunk: unknown) => {
              controller.enqueue(
                typeof chunk === "string"
                  ? new TextEncoder().encode(chunk)
                  : new Uint8Array(chunk as ArrayBufferLike),
              );
            });
            res.on("end", () => controller.close());
            res.on("error", (error) => controller.error(error));
          },
          cancel() {
            res.destroy();
          },
        });

        resolve(
          new Response(bodyStream, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "",
            headers: headersFromObject(res.headers),
          }),
        );
      },
    );

    const onAbort = () => {
      req.destroy(abortError());
      reject(abortError());
    };
    init?.signal?.addEventListener("abort", onAbort, { once: true });

    req.on("error", (error) => reject(error));
    req.on("close", () => init?.signal?.removeEventListener("abort", onAbort));
    if (body != null) req.write(bodyToNodeChunk(body));
    req.end();
  });
}
