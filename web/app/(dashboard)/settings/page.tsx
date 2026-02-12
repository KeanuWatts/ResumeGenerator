"use client";

import { useEffect, useState } from "react";
import { getProfile } from "@/lib/api";

export default function SettingsPage() {
  const [profile, setProfile] = useState<{ fullName?: string; email?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProfile()
      .then((r: { profile?: { fullName?: string; email?: string } }) => setProfile(r.profile || null))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container stack-lg">
      <h1>Settings</h1>
      <p className="text-muted">Profile, API keys (DeepSeek optional), default template, export preference.</p>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : profile ? (
        <div className="card card-lg" style={{ marginTop: "1rem" }}>
          <p><strong>Name:</strong> {profile.fullName || "—"}</p>
          <p><strong>Email:</strong> {profile.email || "—"}</p>
          <p className="text-muted" style={{ fontSize: "0.875rem" }}>API keys and template settings will be available when the backend is connected.</p>
        </div>
      ) : (
        <p className="text-muted">Could not load profile.</p>
      )}
    </div>
  );
}
