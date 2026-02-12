"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getJob, extractJob } from "@/lib/api";

export default function EditJobPage() {
  const params = useParams();
  const id = params.id as string;
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    getJob(id)
      .then((r) => setJob(r as Record<string, unknown>))
      .catch(() => setJob(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleExtract() {
    setExtracting(true);
    try {
      const extracted = await extractJob(id) as Record<string, unknown>;
      setJob((prev) => (prev ? { ...prev, ...extracted } : { _id: id, ...extracted }));
    } finally {
      setExtracting(false);
    }
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!job) return <div className="container"><p className="text-muted">Job not found. <Link href="/jobs">Back to list</Link></p></div>;

  return (
    <div className="container stack-lg">
      <p><Link href="/jobs" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to jobs</Link></p>
      <div className="card card-lg">
        <h1>Edit job description</h1>
        <div className="stack" style={{ marginTop: "1rem" }}>
          <div><strong>Title:</strong> {(job.title as string) || "—"}</div>
          <div><strong>Company:</strong> {(job.company as string) || "—"}</div>
          <button type="button" className="btn btn-accent" onClick={handleExtract} disabled={extracting}>
            {extracting ? "Extracting…" : "Extract fields from description (AI)"}
          </button>
        </div>
        <div className="stack" style={{ marginTop: "1.5rem" }}>
          <label>Raw description</label>
          <textarea
            value={(job.rawText as string) || ""}
            onChange={(e) => setJob({ ...job, rawText: e.target.value })}
            rows={12}
          />
        </div>
      </div>
    </div>
  );
}
