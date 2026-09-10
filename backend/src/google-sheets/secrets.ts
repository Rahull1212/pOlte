import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Every Google settings row in this feature is one-per-install, so they all
// share this fixed primary key rather than each inventing their own.
export const SINGLETON_ID = "default";

// Google credentials stored by this app — a service-account private key, an
// OAuth client secret, a refresh token — are all live keys to the campaign's
// Google data, so none is stored in the clear. AES-256-GCM (authenticated,
// so tampering is detected rather than silently decrypting to garbage) with a
// key derived from JWT_ACCESS_SECRET: the app already treats that as its root
// secret, and deriving from it avoids introducing yet another one to manage.
//
// Consequence worth knowing: rotating JWT_ACCESS_SECRET makes stored Google
// credentials unreadable and they must be re-entered — decryptSecret says
// exactly that rather than failing cryptically.
function secretKey(): Buffer {
  const source = process.env.JWT_ACCESS_SECRET;
  if (!source) throw new Error("JWT_ACCESS_SECRET must be set to store Google credentials");
  return scryptSync(source, "polios-google-credentials", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  // iv:authTag:ciphertext — self-contained, so nothing else has to be stored.
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, payload] = stored.split(":");
  if (!iv || !tag || !payload) throw new Error("Stored Google credential is malformed — reconnect Google");
  try {
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored Google credential could not be decrypted (JWT_ACCESS_SECRET changed?) — reconnect Google");
  }
}
