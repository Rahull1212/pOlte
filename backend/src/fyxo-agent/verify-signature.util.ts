import { createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_SECONDS = 5 * 60;

/**
 * Verifies Fyxo's webhook signature — confirmed against the published
 * API.md (§10): header `x-fyxo-signature: t=<unix_seconds>,v1=<hex_hmac>`,
 * HMAC-SHA256 over `"{timestamp}.{rawBody}"` keyed by the endpoint secret,
 * reject anything older than 5 minutes, compare with a timing-safe equal.
 * (An older `x-bwa-signature` — body-only, no timestamp — exists for
 * legacy integrations; the docs say not to use it for new ones since it's
 * replayable, so it's intentionally not supported here.)
 */
export function verifyFyxoSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;

  const parts: Record<string, string> = {};
  for (const kv of signatureHeader.split(",")) {
    const [key, value] = kv.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(ageSeconds) || ageSeconds > REPLAY_WINDOW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");

  let expectedBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, "hex");
    actualBuf = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
