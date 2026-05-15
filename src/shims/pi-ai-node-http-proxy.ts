/**
 * Stub for pi-ai's node-http-proxy module.
 * The real module imports http-proxy-agent, https-proxy-agent, and node:http/https/child_process
 * which are not available in the Obsidian browser environment.
 * Bedrock is the only consumer; proxying is not needed for Obsidian.
 */

export function createHttpProxyAgentsForTarget(_target: string): {
  httpAgent?: object;
  httpsAgent?: object;
} {
  return {};
}
