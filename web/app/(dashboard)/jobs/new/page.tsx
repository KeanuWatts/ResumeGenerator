"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createJob } from "@/lib/api";

export default function NewJobPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await createJob({ title, company, rawText }) as { _id?: string };
      if (r._id) router.push(`/jobs/${r._id}/edit`);
      else router.push("/jobs");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container stack-lg">
      <p><Link href="/jobs" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to jobs</Link></p>
      <div className="card card-lg">
        <h1>Add job description</h1>
        <form onSubmit={handleSubmit} className="stack-lg" style={{ marginTop: "1rem" }}>
          <div>
            <label>Title (optional; can extract from text)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label>Company (optional)</label>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div>
            <label>Raw job description (paste here)</label>
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={10} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </form>
      </div>
    </div>
  );
}
