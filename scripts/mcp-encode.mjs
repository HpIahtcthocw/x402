/** Base64 encode/decode helpers for x402 MCP server. */
export function base64encode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}
export function base64decode(b64) {
  return Buffer.from(b64, "base64url");
}
