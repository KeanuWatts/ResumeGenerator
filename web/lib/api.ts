/**
 * API client. Uses NEXT_PUBLIC_API_URL for real API; stub mode for UI-only testing.
 * Real API: sends JWT, on 401 tries refresh then retry; on refresh failure redirects to /login.
 */

const BASE = typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_API_URL || "") : "";

export type StubMode = "stub" | "real";

function getStubMode(): StubMode {
  if (typeof window === "undefined") return "real";
  return (process.env.NEXT_PUBLIC_USE_STUB_API === "true" ? "stub" : "real") as StubMode;
}

export type ApiAuthCallbacks = {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (access: string | null, refresh: string | null) => void;
  onUnauthorized: () => void;
};

let apiAuth: ApiAuthCallbacks | null = null;

export function setApiAuth(callbacks: ApiAuthCallbacks | null): void {
  apiAuth = callbacks;
}

async function refreshTokens(): Promise<boolean> {
  if (!apiAuth) return false;
  const refreshToken = apiAuth.getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${BASE}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const json = await res.json();
  const data = json?.data ?? json;
  const access = data?.accessToken ?? null;
  const refresh = data?.refreshToken ?? null;
  if (access && refresh) {
    apiAuth.setTokens(access, refresh);
    return true;
  }
  return false;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  stubData?: T,
  retried = false
): Promise<T> {
  if (getStubMode() === "stub" && stubData !== undefined) {
    await new Promise((r) => setTimeout(r, 300));
    return stubData as T;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as Record<string, string>) };
  if (apiAuth) {
    const token = apiAuth.getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 && apiAuth && !retried) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, options, stubData, true);
    apiAuth.onUnauthorized();
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = `API ${res.status}: ${res.statusText}`;
    try {
      const j = JSON.parse(text);
      if (j?.error) msg = j.error;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    throw new Error(msg);
  }

  return res.json();
}

// Auth
export async function login(email: string, password: string) {
  const res = await request<{ success?: boolean; data?: { accessToken: string; refreshToken: string; expiresIn: number } } | { accessToken: string; refreshToken: string; expiresIn: number }>(
    "/v1/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    getStubMode() === "stub"
      ? { success: true, data: { accessToken: "stub-token", refreshToken: "stub-refresh", expiresIn: 900 } }
      : undefined
  );
  if (getStubMode() === "stub") return res as { success: true; data: { accessToken: string; refreshToken: string; expiresIn: number } };
  const data = (res as { data?: { accessToken: string; refreshToken: string; expiresIn: number } }).data;
  return { success: true as const, data: data ?? (res as { accessToken: string; refreshToken: string; expiresIn: number }) };
}

export async function register(email: string, password: string, fullName: string) {
  return request(
    "/v1/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ email, password, fullName }),
    },
    getStubMode() === "stub" ? { success: true, data: { id: "stub-user-id", email } } : undefined
  );
}

export async function logout() {
  if (getStubMode() === "stub") return Promise.resolve({ success: true });
  return request("/v1/auth/logout", { method: "POST" });
}

export async function getMe() {
  return request(
    "/v1/auth/me",
    {},
    getStubMode() === "stub"
      ? { success: true, data: { id: "stub-user-id", email: "user@example.com", profile: { fullName: "Stub User" } } }
      : undefined
  );
}

// Resumes
export async function listResumes() {
  return request(
    "/v1/resumes",
    {},
    getStubMode() === "stub"
      ? { data: [{ _id: "r1", name: "Master Resume", isDefault: true }], total: 1 }
      : undefined
  );
}

export async function getResume(id: string) {
  return request(
    `/v1/resumes/${id}`,
    {},
    getStubMode() === "stub"
      ? { _id: id, name: "Master Resume", contact: {}, summary: {}, skills: [], experience: [] }
      : undefined
  );
}

export async function createResume(body: { name: string }) {
  return request(
    "/v1/resumes",
    { method: "POST", body: JSON.stringify(body) },
    getStubMode() === "stub" ? { _id: "r-new", name: body.name } : undefined
  );
}

export async function updateResume(id: string, body: object) {
  return request(
    `/v1/resumes/${id}`,
    { method: "PUT", body: JSON.stringify(body) },
    getStubMode() === "stub" ? { _id: id, ...body } : undefined
  );
}

export async function deleteResume(id: string) {
  return request(
    `/v1/resumes/${id}`,
    { method: "DELETE" },
    getStubMode() === "stub" ? { success: true } : undefined
  );
}

// Jobs
export async function listJobs() {
  return request(
    "/v1/jobs",
    {},
    getStubMode() === "stub"
      ? { data: [{ _id: "j1", title: "Sample Job", company: "Acme" }], total: 1 }
      : undefined
  );
}

export async function getJob(id: string) {
  return request(
    `/v1/jobs/${id}`,
    {},
    getStubMode() === "stub"
      ? { _id: id, title: "Sample Job", company: "Acme", rawText: "" }
      : undefined
  );
}

export async function createJob(body: { title?: string; company?: string; rawText?: string }) {
  return request(
    "/v1/jobs",
    { method: "POST", body: JSON.stringify(body) },
    getStubMode() === "stub" ? { _id: "j-new", ...body } : undefined
  );
}

export async function updateJob(id: string, body: object) {
  return request(
    `/v1/jobs/${id}`,
    { method: "PUT", body: JSON.stringify(body) },
    getStubMode() === "stub" ? { _id: id } : undefined
  );
}

export async function deleteJob(id: string) {
  return request(
    `/v1/jobs/${id}`,
    { method: "DELETE" },
    getStubMode() === "stub" ? { success: true } : undefined
  );
}

export async function extractJob(id: string) {
  return request(
    `/v1/jobs/${id}/extract`,
    { method: "POST" },
    getStubMode() === "stub"
      ? { success: true, data: { title: "Extracted Title", company: "Extracted Co", ksas: [], acronyms: [] } }
      : undefined
  );
}

// Generate
export async function generateResume(body: { resumeId: string; jobDescriptionId: string }) {
  return request(
    "/v1/generate/resume",
    { method: "POST", body: JSON.stringify(body) },
    getStubMode() === "stub"
      ? { success: true, data: { documentId: "doc-1", type: "resume" } }
      : undefined
  );
}

export async function generateCoverLetter(body: { resumeId: string; jobDescriptionId: string }) {
  return request(
    "/v1/generate/cover-letter",
    { method: "POST", body: JSON.stringify(body) },
    getStubMode() === "stub"
      ? { success: true, data: { documentId: "doc-2", type: "cover_letter" } }
      : undefined
  );
}

// Documents
export async function listDocuments() {
  return request(
    "/v1/documents",
    {},
    getStubMode() === "stub"
      ? { data: [], total: 0 }
      : undefined
  );
}

export async function getDocument(id: string) {
  return request(
    `/v1/documents/${id}`,
    {},
    getStubMode() === "stub"
      ? { _id: id, type: "resume", content: {}, createdAt: new Date().toISOString() }
      : undefined
  );
}

// Settings / user
export async function getProfile() {
  return request(
    "/v1/users/profile",
    {},
    getStubMode() === "stub"
      ? { profile: { fullName: "Stub User", email: "user@example.com" } }
      : undefined
  );
}
