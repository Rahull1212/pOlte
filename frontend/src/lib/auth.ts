"use client";

const TOKEN_COOKIE = "polios_token";
const REFRESH_COOKIE = "polios_refresh_token";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

export function setToken(token: string) {
  // Access token is short-lived (JWT_ACCESS_EXPIRES_IN, 15m by default) — the
  // cookie outlives it on purpose, since api-client silently refreshes it.
  writeCookie(TOKEN_COOKIE, token, 60 * 60 * 24 * 7);
}

export function getToken(): string | null {
  return readCookie(TOKEN_COOKIE);
}

export function setRefreshToken(token: string) {
  writeCookie(REFRESH_COOKIE, token, 60 * 60 * 24 * 7);
}

export function getRefreshToken(): string | null {
  return readCookie(REFRESH_COOKIE);
}

export function clearToken() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0`;
  document.cookie = `${REFRESH_COOKIE}=; path=/; max-age=0`;
}

// NOTE: this stores the JWT in a plain (non-httpOnly) cookie so both the
// Next.js middleware and client fetches can read it without an extra
// round trip. For a hardened production deploy, move token issuance behind
// a Next.js route handler that sets an httpOnly cookie instead.
