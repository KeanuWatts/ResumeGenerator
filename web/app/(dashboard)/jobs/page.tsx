"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listJobs } from "@/lib/api";

type Job = { _id: string; title?: string; company?: string };

export default function JobsPage() {
  const [jobs, setJobs] = useState<{ data?: Job[] }>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listJobs()
      .then((r: { data?: Job[] }) => setJobs(r))
      .catch(() => setJobs({}))
      .finally(() => setLoading(false));
  }, []);

  const list = jobs.data || [];

  return (
    <div className="container stack-lg">
      <h1>Job descriptions</h1>
      <p className="text-muted">Manage saved job descriptions. Paste raw text and run extract to get title, company, and KSAs.</p>
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <p><Link href="/jobs/new" className="btn btn-primary">Add job</Link></p>
          <ul className="page-list card" style={{ marginTop: "1rem" }}>
            {list.map((j) => (
              <li key={j._id}>
                <Link href={`/jobs/${j._id}/edit`}>
                  {j.title || "Untitled"} at {j.company || "—"}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
