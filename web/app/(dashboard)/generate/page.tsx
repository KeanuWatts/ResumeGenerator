"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listResumes, listJobs, generateResume, generateCoverLetter } from "@/lib/api";

type Resume = { _id: string; name: string };
type Job = { _id: string; title?: string; company?: string };

export default function GeneratePage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [genLoading, setGenLoading] = useState(false);
  const [lastDoc, setLastDoc] = useState<{ documentId?: string; type?: string } | null>(null);

  useEffect(() => {
    Promise.all([listResumes(), listJobs()])
      .then(([r, j]) => {
        const rData = (r as { data?: Resume[] }).data || [];
        const jData = (j as { data?: Job[] }).data || [];
        setResumes(rData);
        setJobs(jData);
        if (rData.length && !resumeId) setResumeId(rData[0]._id);
        if (jData.length && !jobId) setJobId(jData[0]._id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleGenerateResume() {
    if (!resumeId || !jobId) return;
    setGenLoading(true);
    setLastDoc(null);
    try {
      const res = await generateResume({ resumeId, jobDescriptionId: jobId }) as { data?: { documentId?: string; type?: string } };
      setLastDoc(res.data || null);
    } finally {
      setGenLoading(false);
    }
  }

  async function handleGenerateCoverLetter() {
    if (!resumeId || !jobId) return;
    setGenLoading(true);
    setLastDoc(null);
    try {
      const res = await generateCoverLetter({ resumeId, jobDescriptionId: jobId }) as { data?: { documentId?: string; type?: string } };
      setLastDoc(res.data || null);
    } finally {
      setGenLoading(false);
    }
  }

  if (loading) return <div className="container"><p className="text-muted">Loading…</p></div>;

  return (
    <div className="container stack-lg">
      <h1>Generate</h1>
      <p className="text-muted">Select a resume and job, then generate a tailored resume or cover letter.</p>
      <div className="card card-lg stack-lg" style={{ marginTop: "1rem" }}>
        <div>
          <label>Resume</label>
          <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
            {resumes.map((r) => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Job description</label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            {jobs.map((j) => (
              <option key={j._id} value={j._id}>{j.title || "Untitled"} at {j.company || "—"}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerateResume}
            disabled={genLoading || !resumeId || !jobId}
          >
            {genLoading ? "Generating…" : "Generate tailored resume"}
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={handleGenerateCoverLetter}
            disabled={genLoading || !resumeId || !jobId}
          >
            Generate cover letter
          </button>
        </div>
        {lastDoc && (
          <p className="text-muted" style={{ marginTop: "0.5rem" }}>
            Created: <Link href={`/documents/${lastDoc.documentId}`}>{lastDoc.type} document</Link>
          </p>
        )}
      </div>
    </div>
  );
}
