"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getJob, updateJob, extractJob } from "@/lib/api";

type Ksa = { term?: string; category?: string; importance?: string };
type Acronym = { acronym?: string; expansion?: string };

type Job = {
  _id?: string;
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  rawText?: string;
  notes?: string;
  tags?: string[];
  status?: string;
  ksas?: Ksa[];
  acronyms?: Acronym[];
  [key: string]: unknown;
};

const STATUS_OPTIONS = ["saved", "applied", "interviewing", "rejected", "offer"];

export default function EditJobPage() {
  const params = useParams();
  const id = params.id as string;
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    getJob(id)
      .then((r) => setJob(r as Job))
      .catch(() => setJob(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    setSaving(true);
    setMessage(null);
    try {
      await updateJob(id, {
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        rawText: job.rawText,
        notes: job.notes,
        tags: job.tags,
        status: job.status,
      });
      setMessage({ type: "ok", text: "Saved." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  }

  async function handleExtract() {
    setExtracting(true);
    setMessage(null);
    try {
      const res = await extractJob(id) as { success?: boolean; data?: { title?: string; company?: string; ksas?: Ksa[]; acronyms?: Acronym[] } };
      const data = res?.data ?? res;
      if (data && typeof data === "object" && ("title" in data || "company" in data || "ksas" in data || "acronyms" in data)) {
        setJob((prev) => prev ? { ...prev, ...data } : { _id: id, ...data });
        setMessage({ type: "ok", text: "Extraction complete. Review title, company, KSAs, and acronyms below." });
      } else {
        setMessage({ type: "err", text: "Unexpected response from extract." });
      }
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Extract failed. Is DeepSeek API key set?" });
    } finally {
      setExtracting(false);
    }
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;
  if (!job) return <div className="container"><p className="text-muted">Job not found. <Link href="/jobs">Back to list</Link></p></div>;

  const ksas = job.ksas ?? [];
  const acronyms = job.acronyms ?? [];

  return (
    <div className="container stack-lg">
      <p><Link href="/jobs" className="text-muted" style={{ fontSize: "0.875rem" }}>← Back to jobs</Link></p>
      <div className="card card-lg">
        <h1>Edit job description</h1>
        {message && (
          <p className={message.type === "ok" ? "text-muted" : "error"} style={{ fontSize: "0.875rem" }}>
            {message.text}
          </p>
        )}
        <form onSubmit={handleSave} className="stack-lg" style={{ marginTop: "1rem" }}>
          <div>
            <label>Title</label>
            <input
              type="text"
              value={job.title ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, title: e.target.value } : j)}
            />
          </div>
          <div>
            <label>Company</label>
            <input
              type="text"
              value={job.company ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, company: e.target.value } : j)}
            />
          </div>
          <div>
            <label>Location</label>
            <input
              type="text"
              value={job.location ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, location: e.target.value } : j)}
            />
          </div>
          <div>
            <label>Job posting URL</label>
            <input
              type="url"
              value={job.url ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, url: e.target.value } : j)}
              placeholder="https://..."
            />
          </div>
          <div>
            <label>Application status</label>
            <select
              value={job.status ?? "saved"}
              onChange={(e) => setJob((j) => j ? { ...j, status: e.target.value } : j)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Notes</label>
            <textarea
              rows={2}
              value={job.notes ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, notes: e.target.value } : j)}
            />
          </div>
          <div>
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={(job.tags ?? []).join(", ")}
              onChange={(e) => setJob((j) => j ? { ...j, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) } : j)}
              placeholder="e.g. remote, senior, python"
            />
          </div>
          <div>
            <label>Raw job description (paste here)</label>
            <textarea
              rows={12}
              value={job.rawText ?? ""}
              onChange={(e) => setJob((j) => j ? { ...j, rawText: e.target.value } : j)}
              placeholder="Paste the full job description. Use Extract to pull title, company, KSAs, and acronyms with AI."
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={handleExtract}
              disabled={extracting || !(job.rawText ?? "").trim()}
            >
              {extracting ? "Extracting…" : "Extract fields (AI)"}
            </button>
          </div>
        </form>

        {(ksas.length > 0 || acronyms.length > 0) && (
          <div className="stack" style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
            {ksas.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>KSAs (Knowledge, Skills, Abilities)</h3>
                <ul className="page-list" style={{ fontSize: "0.875rem" }}>
                  {ksas.map((k, i) => (
                    <li key={i}>{k.term} {k.category ? `(${k.category})` : ""} {k.importance ? `[${k.importance}]` : ""}</li>
                  ))}
                </ul>
              </div>
            )}
            {acronyms.length > 0 && (
              <div>
                <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Acronyms</h3>
                <ul className="page-list" style={{ fontSize: "0.875rem" }}>
                  {acronyms.map((a, i) => (
                    <li key={i}><strong>{a.acronym}</strong> {a.expansion ? `— ${a.expansion}` : ""}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
