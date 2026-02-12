"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getResume, updateResume } from "@/lib/api";

export default function EditResumePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [resume, setResume] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getResume(id)
      .then((r) => setResume(r as Record<string, unknown>))
      .catch(() => setResume(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!resume) return;
    setSaving(true);
    try {
      await updateResume(id, resume);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!resume) return <div className="container"><p className="text-muted">Resume not found. <Link href="/resumes">Back to list</Link></p></div>;

  return (
    <div className="container stack-lg">
      <p><Link href="/resumes" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to resumes</Link></p>
      <div className="card card-lg">
        <h1>Edit resume</h1>
        <form onSubmit={handleSave} className="stack-lg" style={{ marginTop: "1rem" }}>
          <div>
            <label>Name</label>
            <input
              type="text"
              value={(resume.name as string) || ""}
              onChange={(e) => setResume({ ...resume, name: e.target.value })}
            />
          </div>
          <p className="text-muted" style={{ fontSize: "0.875rem" }}>Additional sections (contact, summary, skills, experience) will be editable in later phases.</p>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      </div>
    </div>
  );
}
