"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  clearStoredTokens,
  getStoredAccessToken,
  getStoredRefreshToken,
  setStoredTokens,
} from "@/lib/auth-storage";
import { setApiAuth } from "@/lib/api";

type AuthContextValue = {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string | null, refresh: string | null) => void;
  clearTokens: () => void;
  isAuthenticated: boolean;
  hydrated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setAccessToken(getStoredAccessToken());
    setRefreshToken(getStoredRefreshToken());
    setHydrated(true);
  }, []);

  const setTokens = useCallback((access: string | null, refresh: string | null) => {
    setStoredTokens(access, refresh);
    setAccessToken(access);
    setRefreshToken(refresh);
  }, []);

  const clearTokens = useCallback(() => {
    clearStoredTokens();
    setAccessToken(null);
    setRefreshToken(null);
  }, []);

  const onUnauthorized = useCallback(() => {
    clearStoredTokens();
    setAccessToken(null);
    setRefreshToken(null);
    if (typeof window !== "undefined") window.location.href = "/login";
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setApiAuth({
      getAccessToken: () => getStoredAccessToken(),
      getRefreshToken: () => getStoredRefreshToken(),
      setTokens,
      onUnauthorized,
    });
  }, [hydrated, setTokens, onUnauthorized]);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      refreshToken,
      setTokens,
      clearTokens,
      isAuthenticated: !!(accessToken && refreshToken),
      hydrated,
    }),
    [accessToken, refreshToken, setTokens, clearTokens, hydrated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
