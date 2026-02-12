/**
 * Client-side token storage (localStorage).
 * Keys used: resumegen_access_token, resumegen_refresh_token.
 */

const ACCESS_KEY = "resumegen_access_token";
const REFRESH_KEY = "resumegen_refresh_token";

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setStoredTokens(accessToken: string | null, refreshToken: string | null): void {
  if (typeof window === "undefined") return;
  if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  else localStorage.removeItem(ACCESS_KEY);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_KEY);
}

export function clearStoredTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function hasStoredTokens(): boolean {
  return !!(getStoredAccessToken() && getStoredRefreshToken());
}
