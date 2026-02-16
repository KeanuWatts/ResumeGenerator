"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getProfile,
  updateProfile,
  updateSettings,
  updateApiKeys,
  deleteAccount,
  listTemplates,
} from "@/lib/api";

type Profile = {
  fullName?: string;
  phone?: string;
  location?: { city?: string; state?: string; country?: string };
  linkedin?: string;
  website?: string;
  headline?: string;
};

type Settings = {
  defaultTemplateId?: string;
  exportFormat?: string;
  aiPreferences?: { temperature?: number; model?: string };
};

type Template = { _id: string; name: string; isDefault?: boolean };

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [settings, setSettings] = useState<Settings>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [deepseekKey, setDeepseekKey] = useState("");
  const [reactiveResumeKey, setReactiveResumeKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([getProfile(), listTemplates()])
      .then(([profileRes, templatesRes]) => {
        const data = (profileRes as { data?: { profile?: Profile; email?: string; settings?: Settings } })?.data;
        if (data?.profile) setProfile(data.profile);
        if (data?.email) setEmail(data.email);
        if (data?.settings) setSettings(data.settings);
        const list = (templatesRes as { data?: Template[] })?.data ?? [];
        setTemplates(list);
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSavingProfile(true);
    setMessage(null);
    try {
      await updateProfile(profile);
      setMessage({ type: "ok", text: "Profile saved." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Failed to save profile." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setMessage(null);
    try {
      await updateSettings(settings);
      setMessage({ type: "ok", text: "Settings saved." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Failed to save settings." });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveApiKeys(e: React.FormEvent) {
    e.preventDefault();
    setSavingKeys(true);
    setMessage(null);
    try {
      await updateApiKeys({ deepseek: deepseekKey || undefined, reactiveResume: reactiveResumeKey || undefined });
      setMessage({ type: "ok", text: "API keys updated." });
      setDeepseekKey("");
      setReactiveResumeKey("");
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Failed to save API keys." });
    } finally {
      setSavingKeys(false);
    }
  }

  async function handleDeleteAccount() {
    if (!confirm("Permanently delete your account and all data? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await deleteAccount();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Failed to delete account." });
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;

  return (
    <div className="container stack-lg">
      <h1>Settings</h1>
      {message && (
        <p className={message.type === "ok" ? "text-muted" : "error"} style={{ fontSize: "0.875rem" }}>
          {message.text}
        </p>
      )}

      {/* Profile */}
      <div className="card card-lg">
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Profile</h2>
        <p className="text-muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
          Your name and contact info (used for account display and optional resume defaults).
        </p>
        <form onSubmit={handleSaveProfile} className="stack">
          <div>
            <label>Full name</label>
            <input
              type="text"
              value={profile?.fullName ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
              required
            />
          </div>
          <div>
            <label>Email (account)</label>
            <input type="email" value={email} readOnly disabled style={{ opacity: 0.8 }} />
          </div>
          <div>
            <label>Phone</label>
            <input
              type="text"
              value={profile?.phone ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
            />
          </div>
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: "120px" }}>
              <label>City</label>
              <input
                type="text"
                value={profile?.location?.city ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, location: { ...p?.location, city: e.target.value } }))}
              />
            </div>
            <div style={{ minWidth: "120px" }}>
              <label>State / Region</label>
              <input
                type="text"
                value={profile?.location?.state ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, location: { ...p?.location, state: e.target.value } }))}
              />
            </div>
            <div style={{ minWidth: "120px" }}>
              <label>Country</label>
              <input
                type="text"
                value={profile?.location?.country ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, location: { ...p?.location, country: e.target.value } }))}
              />
            </div>
          </div>
          <div>
            <label>LinkedIn</label>
            <input
              type="url"
              value={profile?.linkedin ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, linkedin: e.target.value }))}
            />
          </div>
          <div>
            <label>Website</label>
            <input
              type="url"
              value={profile?.website ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
            />
          </div>
          <div>
            <label>Headline</label>
            <input
              type="text"
              value={profile?.headline ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, headline: e.target.value }))}
              placeholder="e.g. Senior Software Engineer"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </form>
      </div>

      {/* App settings */}
      <div className="card card-lg">
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>App settings</h2>
        <form onSubmit={handleSaveSettings} className="stack">
          <div>
            <label>Default template</label>
            <select
              value={settings.defaultTemplateId ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, defaultTemplateId: e.target.value || undefined }))}
            >
              <option value="">—</option>
              {templates.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name} {t.isDefault ? "(default)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Export format</label>
            <select
              value={settings.exportFormat ?? "pdf"}
              onChange={(e) => setSettings((s) => ({ ...s, exportFormat: e.target.value }))}
            >
              <option value="pdf">PDF</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingSettings}>
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        </form>
      </div>

      {/* API keys */}
      <div className="card card-lg">
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>API keys</h2>
        <p className="text-muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
          Optional. DeepSeek is used for AI (extract, tailor summary, cover letter). Reactive Resume key is used for PDF export when configured.
        </p>
        <form onSubmit={handleSaveApiKeys} className="stack">
          <div>
            <label>DeepSeek API key</label>
            <input
              type="password"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder="Leave blank to keep existing"
              autoComplete="off"
            />
          </div>
          <div>
            <label>Reactive Resume API key</label>
            <input
              type="password"
              value={reactiveResumeKey}
              onChange={(e) => setReactiveResumeKey(e.target.value)}
              placeholder="Leave blank to keep existing"
              autoComplete="off"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingKeys}>
            {savingKeys ? "Saving…" : "Save API keys"}
          </button>
        </form>
      </div>

      {/* Delete account */}
      <div className="card card-lg" style={{ borderColor: "var(--error)" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Delete account</h2>
        <p className="text-muted" style={{ fontSize: "0.875rem", marginBottom: "1rem" }}>
          Permanently delete your account and all resumes, jobs, and generated documents.
        </p>
        <button
          type="button"
          className="btn"
          onClick={handleDeleteAccount}
          disabled={deleting}
          style={{ background: "var(--error)", color: "white" }}
        >
          {deleting ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </div>
  );
}
